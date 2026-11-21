import ExcelJS from 'exceljs';
import { formatKstTime, calcDday } from './format';

function downloadBuffer(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function styleWorksheet(ws: ExcelJS.Worksheet, numericCols: number[] = []) {
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;

  if (ws.columnCount > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: ws.columnCount },
    };
  }

  for (const colIdx of numericCols) {
    const col = ws.getColumn(colIdx);
    col.numFmt = '#,##0';
  }

  ws.columns?.forEach((column) => {
    let maxLen = 12;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const v = cell.value == null ? '' : String(cell.value);
      maxLen = Math.max(maxLen, Math.min(40, v.length + 6));
    });
    column.width = maxLen;
  });
}

// [관리자 11] 월 결산 엑셀 다운로드 (4개 시트: 정산요약, 운행일지, 차량현황, 정비내역)
export async function exportMonthlySettlementExcel({
  yearMonth,
  logs,
  vehicles,
  maintenance,
}: {
  yearMonth: string;
  logs: any[];
  vehicles: any[];
  maintenance: any[];
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BH로지스틱스 관리자 시스템';
  wb.created = new Date();

  // 1) 정산요약 시트
  const wsSummary = wb.addWorksheet('정산요약');
  wsSummary.columns = [
    { header: '기사', key: 'driverName' },
    { header: '차량번호', key: 'plateNo' },
    { header: '노선', key: 'routeName' },
    { header: '출근일수', key: 'days' },
    { header: '노선단가(원)', key: 'unitPrice' },
    { header: '합계금액(원)', key: 'amount' },
    { header: '총운행거리(km)', key: 'totalKm' },
    { header: '실제GPS거리(km)', key: 'gpsKm' },
    { header: '비업무주행(km)', key: 'offDutyKm' },
    { header: '예상주유비(원)', key: 'fuelCost' },
  ];

  const validLogs = logs.filter(
    (l) => l.status === 'in_progress' || l.status === 'completed'
  );
  const grouped: Record<string, any> = {};
  for (const l of validLogs) {
    const k = `${l.driverId}_${l.routeId || l.routeName}`;
    if (!grouped[k]) {
      grouped[k] = {
        driverName: l.driverName || '',
        plateNo: l.plateNo || '',
        routeName: l.routeName || '',
        days: 0,
        unitPrice: Number(l.routePrice) || 0,
        amount: 0,
        totalKm: 0,
        gpsKm: 0,
        offDutyKm: 0,
        fuelCost: 0,
      };
    }
    grouped[k].days += 1;
    grouped[k].amount += Number(l.routePrice) || 0;
    grouped[k].totalKm += Number(l.drivenKm) || 0;
    grouped[k].gpsKm += Number(l.gpsDrivenKm) || 0;
    grouped[k].offDutyKm += Number(l.offDutyKm) || 0;
    grouped[k].fuelCost += Number(l.estimatedFuelCost) || 0;
  }

  let sumDays = 0;
  let sumAmount = 0;
  let sumKm = 0;
  let sumGpsKm = 0;
  let sumOffKm = 0;
  let sumFuel = 0;

  Object.values(grouped).forEach((row: any) => {
    sumDays += row.days;
    sumAmount += row.amount;
    sumKm += row.totalKm;
    sumGpsKm += row.gpsKm;
    sumOffKm += row.offDutyKm;
    sumFuel += row.fuelCost;
    wsSummary.addRow(row);
  });

  const totalRow = wsSummary.addRow({
    driverName: '합계',
    plateNo: '',
    routeName: '',
    days: sumDays,
    unitPrice: 0,
    amount: sumAmount,
    totalKm: sumKm,
    gpsKm: sumGpsKm,
    offDutyKm: sumOffKm,
    fuelCost: sumFuel,
  });
  totalRow.font = { bold: true };
  styleWorksheet(wsSummary, [4, 5, 6, 7, 8, 9, 10]);

  // 2) 운행일지 시트
  const wsLogs = wb.addWorksheet('운행일지');
  wsLogs.columns = [
    { header: '날짜', key: 'workDate' },
    { header: '기사', key: 'driverName' },
    { header: '차량번호', key: 'plateNo' },
    { header: '노선', key: 'routeName' },
    { header: '단가(원)', key: 'routePrice' },
    { header: '출근시각(KST)', key: 'checkInAt' },
    { header: '시작km', key: 'startOdometerKm' },
    { header: '퇴근시각(KST)', key: 'checkOutAt' },
    { header: '종료km', key: 'endOdometerKm' },
    { header: '운행km', key: 'drivenKm' },
    { header: '실제GPS km', key: 'gpsDrivenKm' },
    { header: '비업무km', key: 'offDutyKm' },
    { header: '운행시간(분)', key: 'workDurationMinutes' },
    { header: '예상주유비(원)', key: 'estimatedFuelCost' },
    { header: '퇴근주소(시구동)', key: 'endAddress' },
    { header: '퇴근위도', key: 'lat' },
    { header: '퇴근경도', key: 'lng' },
    { header: '점검이상', key: 'hasIssue' },
    { header: '거리상태', key: 'kmCheck' },
    { header: '특이사항', key: 'notes' },
    { header: '상태', key: 'status' },
  ];

  logs.forEach((l) => {
    const loc = l.endLocation;
    const notes = [l.startNote, l.endNote].filter(Boolean).join(' / ');
    wsLogs.addRow({
      workDate: l.workDate || '',
      driverName: l.driverName || '',
      plateNo: l.plateNo || '',
      routeName: l.routeName || '',
      routePrice: Number(l.routePrice) || 0,
      checkInAt: formatKstTime(l.checkInAt),
      startOdometerKm: Number(l.startOdometerKm) || 0,
      checkOutAt: formatKstTime(l.checkOutAt),
      endOdometerKm: Number(l.endOdometerKm) || 0,
      drivenKm: Number(l.drivenKm) || 0,
      gpsDrivenKm: Number(l.gpsDrivenKm) || 0,
      offDutyKm: Number(l.offDutyKm) || 0,
      workDurationMinutes: Number(l.workDurationMinutes) || 0,
      estimatedFuelCost: Number(l.estimatedFuelCost) || 0,
      endAddress: l.endAddress || '',
      lat: loc?.latitude ?? '',
      lng: loc?.longitude ?? '',
      hasIssue: l.hasIssue ? 'O' : 'X',
      kmCheck: l.kmCheck || 'ok',
      notes,
      status: l.status || '',
    });
  });
  styleWorksheet(wsLogs, [5, 7, 9, 10, 11, 12, 13, 14]);

  // 3) 차량현황 시트
  const wsVeh = wb.addWorksheet('차량현황');
  wsVeh.columns = [
    { header: '번호판', key: 'plateNo' },
    { header: '차종', key: 'modelName' },
    { header: '연식', key: 'modelYear' },
    { header: '누적주행거리(km)', key: 'odometerKm' },
    { header: '상태', key: 'status' },
    { header: '배정기사', key: 'driver' },
    { header: '주차위치(시구동)', key: 'parkingPlace' },
    { header: '검사만료일', key: 'inspectionDueDate' },
    { header: 'D-Day', key: 'dDay' },
    { header: '예정정비건수', key: 'openMaintenanceCount' },
  ];

  vehicles.forEach((v) => {
    const d = calcDday(v.inspectionDueDate);
    wsVeh.addRow({
      plateNo: v.plateNo || '',
      modelName: `${v.manufacturer || ''} ${v.model || ''}`.trim(),
      modelYear: Number(v.modelYear) || 2021,
      odometerKm: Number(v.odometerKm) || 0,
      status: v.status || 'idle',
      driver: v.assignedDriverName || '공차',
      parkingPlace: v.parking?.placeName || '',
      inspectionDueDate: v.inspectionDueDate || '',
      dDay: d == null ? '' : d >= 0 ? `D-${d}` : `D+${Math.abs(d)}`,
      openMaintenanceCount: Number(v.openMaintenanceCount) || 0,
    });
  });
  styleWorksheet(wsVeh, [4, 10]);

  // 4) 정비내역 시트
  const wsMaint = wb.addWorksheet('정비내역');
  wsMaint.columns = [
    { header: '날짜', key: 'date' },
    { header: '번호판', key: 'plateNo' },
    { header: '분류', key: 'category' },
    { header: '제목', key: 'title' },
    { header: '주행거리(km)', key: 'odometerKm' },
    { header: '비용(원)', key: 'cost' },
    { header: '정비소', key: 'vendor' },
    { header: '상태', key: 'status' },
    { header: '보고자', key: 'reportedByName' },
  ];

  maintenance
    .filter((m) => !m.yearMonth || m.yearMonth === yearMonth)
    .forEach((m) => {
      wsMaint.addRow({
        date: m.performedDate || m.yearMonth || '',
        plateNo: m.plateNo || '',
        category: m.category || '',
        title: m.title || '',
        odometerKm: Number(m.odometerKm) || 0,
        cost: Number(m.cost) || 0,
        vendor: m.vendor || '',
        status: m.status || '',
        reportedByName: m.reportedByName || '',
      });
    });
  styleWorksheet(wsMaint, [5, 6]);

  const buffer = await wb.xlsx.writeBuffer();
  downloadBuffer(buffer, `BH로지스틱스_${yearMonth}_월결산.xlsx`);
}

// 경리 아침 확인용 세금계산서 발행 대기/완료 목록 엑셀 다운로드
export async function exportTaxInvoiceExcel({
  yearMonth,
  items,
}: {
  yearMonth: string;
  items: Array<{
    categoryLabel: string;
    refDate: string;
    clientName: string;
    bizNo?: string;
    courseOrItem: string;
    driverOrVehicle: string;
    supplyAmount: number;
    vatAmount: number;
    totalAmount: number;
    statusLabel: string;
    issuedAtLabel?: string;
    memo?: string;
  }>;
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BH로지스틱스 경리·정산 시스템';
  wb.created = new Date();

  const ws = wb.addWorksheet('세금계산서_발행목록');
  ws.columns = [
    { header: '구분', key: 'categoryLabel' },
    { header: '운행일/기준일', key: 'refDate' },
    { header: '거래처명', key: 'clientName' },
    { header: '사업자번호', key: 'bizNo' },
    { header: '품목/운행코스', key: 'courseOrItem' },
    { header: '기사/차량', key: 'driverOrVehicle' },
    { header: '공급가액(원)', key: 'supplyAmount' },
    { header: '부가세(10%)', key: 'vatAmount' },
    { header: '합계금액(원)', key: 'totalAmount' },
    { header: '발행상태', key: 'statusLabel' },
    { header: '발행완료일', key: 'issuedAtLabel' },
    { header: '비고', key: 'memo' },
  ];

  let sumSupply = 0;
  let sumVat = 0;
  let sumTotal = 0;

  items.forEach((it) => {
    const supply = Number(it.supplyAmount) || 0;
    const vat = Number(it.vatAmount) || 0;
    const total = Number(it.totalAmount) || 0;
    sumSupply += supply;
    sumVat += vat;
    sumTotal += total;
    ws.addRow({
      categoryLabel: it.categoryLabel || '',
      refDate: it.refDate || '',
      clientName: it.clientName || '',
      bizNo: it.bizNo || '',
      courseOrItem: it.courseOrItem || '',
      driverOrVehicle: it.driverOrVehicle || '',
      supplyAmount: supply,
      vatAmount: vat,
      totalAmount: total,
      statusLabel: it.statusLabel || '',
      issuedAtLabel: it.issuedAtLabel || '',
      memo: it.memo || '',
    });
  });

  const totalRow = ws.addRow({
    categoryLabel: '합계',
    refDate: '',
    clientName: `${items.length}건`,
    bizNo: '',
    courseOrItem: '',
    driverOrVehicle: '',
    supplyAmount: sumSupply,
    vatAmount: sumVat,
    totalAmount: sumTotal,
    statusLabel: '',
    issuedAtLabel: '',
    memo: '',
  });
  totalRow.font = { bold: true };
  styleWorksheet(ws, [7, 8, 9]);

  const buffer = await wb.xlsx.writeBuffer();
  downloadBuffer(buffer, `BH로지스틱스_${yearMonth}_세금계산서_발행목록.xlsx`);
}
