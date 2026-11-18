import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { db, secondaryAuth } from '../firebase';

/**
 * 「차량파일」 엑셀(차 량 기 록)을 읽어 Vehicles 컬렉션에 일괄 등록합니다.
 * - 2행: 제목줄, 4행부터 차량 데이터
 * - 열: C 근무처, D 차량등록번호, E 차명, F 적재정량, G 형식, H 차대번호, I 배출가스,
 *       J 차종, K 모델연도, O 보험, T 차검만료일, U 차검최종만료일, V 마지막 검사일,
 *       W 현물출자자, Z 운전자, AA 연락처, AB 운행코스, AC 하이패스
 * - 이미 등록된 번호판은 새로 만들지 않고 제원만 갱신합니다. (주행거리·배정·상태는 유지)
 */

function cellText(cell) {
  if (cell == null) return '';
  if (cell instanceof Date) return '';
  if (typeof cell === 'object') {
    if (cell.richText) return cell.richText.map((t) => t.text).join('').trim();
    if (cell.result != null) return cellText(cell.result);
    if (cell.text != null) return String(cell.text).trim();
    return '';
  }
  return String(cell).trim();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateFromSerial(serial) {
  // 엑셀 날짜 일련번호 -> UTC 날짜
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

function toYmd(cell) {
  let d = null;
  if (cell instanceof Date) d = cell;
  else if (typeof cell === 'number' && cell > 20000) d = dateFromSerial(cell);
  else if (cell && typeof cell === 'object' && cell.result != null) {
    return toYmd(cell.result);
  } else if (typeof cell === 'string') {
    const m = cell.trim().match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    return null;
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate()
  )}`;
}

function toYear(cell) {
  if (cell && typeof cell === 'object' && !(cell instanceof Date)) {
    if (cell.result != null) return toYear(cell.result);
  }
  if (cell instanceof Date) return cell.getUTCFullYear();
  if (typeof cell === 'number') {
    if (cell >= 1980 && cell <= 2100) return cell;
    if (cell > 20000) return dateFromSerial(cell).getUTCFullYear();
  }
  const m = String(cell ?? '').match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

function normPlate(s) {
  return String(s || '').replace(/\s+/g, '');
}

export async function parseVehicleExcel(arrayBuffer) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return;
    const plateNo = normPlate(cellText(row.getCell(4).value));
    if (!plateNo) return;
    const dueFinal = toYmd(row.getCell(21).value);
    const dueStart = toYmd(row.getCell(20).value);
    const driverName = cellText(row.getCell(26).value);
    const insStart = toYmd(row.getCell(18).value);
    const insEndRaw = row.getCell(19).value;
    let insEnd = toYmd(insEndRaw);
    if (!insStart) insEnd = null; // 시작일이 없으면 끝나는 날도 의미 없음
    const flag = (c) => (cellText(row.getCell(c).value) ? true : false);
    rows.push({
      plateNo,
      workplace: cellText(row.getCell(3).value),
      model: cellText(row.getCell(5).value),
      manufacturer: '',
      tonnage: cellText(row.getCell(6).value),
      vehicleType: cellText(row.getCell(7).value),
      vinNo: cellText(row.getCell(8).value),
      emissionGrade: cellText(row.getCell(9).value),
      vehicleClass: cellText(row.getCell(10).value),
      modelYear: toYear(row.getCell(11).value),
      foodCargo: flag(12),
      livestockCargo: flag(13),
      eggCargo: flag(14),
      insuranceCompany: cellText(row.getCell(15).value),
      insuranceAge: cellText(row.getCell(16).value),
      insuranceCancel: cellText(row.getCell(17).value),
      insuranceStart: insStart,
      insuranceEnd: insEnd,
      inspectionStartDate: dueStart,
      inspectionDueDate: dueFinal || dueStart || null,
      lastInspectionDate: toYmd(row.getCell(22).value),
      ownerName: cellText(row.getCell(23).value),
      employmentReportName: cellText(row.getCell(24).value),
      memoDriverName: driverName,
      memoDriverPhone: cellText(row.getCell(27).value),
      routeMemo: cellText(row.getCell(28).value),
      hipassCard: cellText(row.getCell(29).value),
    });
  });
  return rows;
}

/** 등록된 차량을 전부 삭제하고, 기사들의 배정 차량도 비웁니다. */
export async function deleteAllVehicles() {
  const [vSnap, uSnap] = await Promise.all([
    getDocs(collection(db, 'Vehicles')),
    getDocs(collection(db, 'Users')),
  ]);
  const ops = [];
  vSnap.docs.forEach((d) => ops.push((b) => b.delete(d.ref)));
  uSnap.docs.forEach((d) => {
    if (d.data().assignedVehicleId) {
      ops.push((b) =>
        b.set(
          d.ref,
          { assignedVehicleId: null, updatedAt: serverTimestamp() },
          { merge: true }
        )
      );
    }
  });
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach((fn) => fn(batch));
    await batch.commit();
  }
  return vSnap.size;
}

/**
 * 엑셀의 운전자(Z열)로 기사 계정을 만들고 첫 번째 차량에 배정합니다.
 * - 이미 같은 이름의 기사가 있으면 건너뜁니다.
 * - 기사 코드: bh01, bh02 ... (기존 최대 번호 다음부터)
 * - 초기 비밀번호: 연락처 마지막 6자리 (연락처 없으면 000000) → 첫 로그인 때 변경 필수
 */
export async function importDriversFromRows(rows, idByPlate) {
  const uSnap = await getDocs(collection(db, 'Users'));
  const existingNames = new Set();
  let maxNo = 0;
  uSnap.docs.forEach((d) => {
    const u = d.data();
    if (u.name) existingNames.add(String(u.name).trim());
    const m = String(u.driverCode || '').match(/^bh(\d+)$/i);
    if (m) maxNo = Math.max(maxNo, Number(m[1]));
  });

  // 운전자 이름별로 첫 차량 / 연락처 모으기
  const drivers = new Map();
  for (const r of rows) {
    const name = (r.memoDriverName || '').trim();
    if (!name) continue;
    if (!drivers.has(name)) {
      drivers.set(name, { name, phone: '', plates: [] });
    }
    const d = drivers.get(name);
    if (!d.phone && r.memoDriverPhone) d.phone = r.memoDriverPhone;
    d.plates.push(r.plateNo);
  }

  const created = [];
  const skipped = [];
  const failed = [];
  const today = new Date(Date.now() + 9 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  for (const d of drivers.values()) {
    if (existingNames.has(d.name)) {
      skipped.push(d.name);
      continue;
    }
    maxNo += 1;
    const code = `bh${String(maxNo).padStart(2, '0')}`;
    const digits = d.phone.replace(/\D/g, '');
    const pin = digits.length >= 6 ? digits.slice(-6) : '000000';
    try {
      const cred = await createUserWithEmailAndPassword(
        secondaryAuth,
        `${code}@bhlogistics.local`,
        pin
      );
      const uid = cred.user.uid;
      await signOut(secondaryAuth);

      const vehicleId = idByPlate.get(d.plates[0]) || null;
      const batch = writeBatch(db);
      batch.set(doc(db, 'Users', uid), {
        role: 'driver',
        driverCode: code,
        name: d.name,
        phone: d.phone,
        hireDate: today,
        assignedVehicleId: vehicleId,
        defaultRouteId: null,
        mustChangePassword: true,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (vehicleId) {
        batch.set(
          doc(db, 'Vehicles', vehicleId),
          {
            assignedDriverId: uid,
            assignedDriverName: d.name,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();
      created.push({ code, name: d.name, pin, extraPlates: d.plates.slice(1) });
    } catch (err) {
      failed.push(`${d.name}(${err.code || err.message})`);
    }
  }
  return { created, skipped, failed };
}

export async function importVehicles(rows) {
  const snap = await getDocs(collection(db, 'Vehicles'));
  const byPlate = new Map();
  snap.docs.forEach((d) => {
    const p = normPlate(d.data().plateNo);
    if (p) byPlate.set(p, d.id);
  });

  let created = 0;
  let updated = 0;
  let batch = writeBatch(db);
  let count = 0;

  for (const r of rows) {
    const common = {
      plateNo: r.plateNo,
      model: r.model,
      workplace: r.workplace,
      tonnage: r.tonnage,
      vehicleType: r.vehicleType,
      vinNo: r.vinNo,
      emissionGrade: r.emissionGrade,
      vehicleClass: r.vehicleClass,
      foodCargo: r.foodCargo,
      livestockCargo: r.livestockCargo,
      eggCargo: r.eggCargo,
      insuranceCompany: r.insuranceCompany,
      insuranceAge: r.insuranceAge,
      insuranceCancel: r.insuranceCancel,
      insuranceStart: r.insuranceStart,
      insuranceEnd: r.insuranceEnd,
      inspectionStartDate: r.inspectionStartDate,
      ownerName: r.ownerName,
      employmentReportName: r.employmentReportName,
      memoDriverName: r.memoDriverName,
      memoDriverPhone: r.memoDriverPhone,
      routeMemo: r.routeMemo,
      hipassCard: r.hipassCard,
      updatedAt: serverTimestamp(),
    };
    if (r.modelYear) common.modelYear = r.modelYear;
    if (r.inspectionDueDate) common.inspectionDueDate = r.inspectionDueDate;
    if (r.lastInspectionDate) common.lastInspectionDate = r.lastInspectionDate;

    const existingId = byPlate.get(r.plateNo);
    if (existingId) {
      batch.set(doc(db, 'Vehicles', existingId), common, { merge: true });
      updated += 1;
    } else {
      const ref = doc(collection(db, 'Vehicles'));
      batch.set(ref, {
        manufacturer: '',
        modelYear: 0,
        odometerKm: 0,
        fuelEfficiencyKmPerL: 5.5,
        status: 'idle',
        assignedDriverId: null,
        assignedDriverName: null,
        openMaintenanceCount: 0,
        isActive: true,
        createdAt: serverTimestamp(),
        ...common,
      });
      byPlate.set(r.plateNo, ref.id);
      created += 1;
    }
    count += 1;
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
  return { created, updated, idByPlate: byPlate };
}
