/**
 * 카카오톡 단톡방 요약 배차 · 밀크런 상세 주소 · 엑셀 배차표 자동 분석기 (0원 클라이언트 파서)
 */

export const SAMPLE_KAKAO_DISPATCH_TEXT = `6번 정태광님
냉장7파렛 9시
청주.증평 ㅡ 용인 17만
11시30분하차/1도,10도

8번 김유빈님
냉장5파렛 1도 10시50분
유성 ㅡ 용인 19만
14시10분하차

> 밀크런 6번 / 냉장 총 7파렛

상차 9:00 | JV ONESWILL | 냉장(+10°C) | 2파렛
충청북도 청주시 청원구 북이면 내수로 796-105 JV ONESWILL
담당 정한영 010-2336-4568
☆☆냉장10도 상품 (5~10도 유지) ☆☆

상차 9:00 | JV ONESWILL | 냉장(+1°C) | 5파렛
충청북도 증평군 증평읍 중부로 2645 (중부로 2641 주유소 쪽으로 진입)
담당 정한영 010-2336-4568
☆☆냉장1도 상품 (0~5도 유지) ☆☆

하차 11:30 | 신선용인3
경기도 용인시 처인구 남사읍 처인성로 1027 (지하 1층)

> 밀크런 8번 / 냉장 총 5파렛

상차 10:50 | 주식회사 에르코스 농업회사법인 | 냉장(+1°C) | 5파렛
대전광역시 유성구 도안동로 329 에르코스
담당 신인수 010-8255-9839
☆☆냉장1도 상품 (0~5도 유지) ☆☆

하차 14:10 | 신선용인3
경기도 용인시 처인구 남사읍 처인성로 1027 (지하 1층)

303	11월 21일	정태광	[용인3센터]	[대전1센터]	대전88아1895	010-4171-8990	3호	11T	1200	1도
315	11월 21일	김유빈	[용인3센터]	[곤지암1센터]	경기92자5402	010-8121-9096	3호	11T	1430	1도
306	11월 21일	김유빈	[용인3센터]	[대전1센터]	경기92자5402	010-8121-9096	6호	11T	1700	1도`;

function formatHm(hStr, mStr = '0') {
  const h = String(Number(hStr) || 0).padStart(2, '0');
  const m = String(Number(mStr) || 0).padStart(2, '0');
  return `${h}:${m}`;
}

function normalizeTimeStr(raw) {
  if (!raw) return '';
  const colonMatch = String(raw).match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (colonMatch) return formatHm(colonMatch[1], colonMatch[2]);
  const korMatch = String(raw).match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  if (korMatch) return formatHm(korMatch[1], korMatch[2] || '0');
  const hhmmMatch = String(raw).trim().match(/^(\d{2})(\d{2})$/);
  if (hhmmMatch) {
    const h = Number(hhmmMatch[1]);
    const m = Number(hhmmMatch[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return formatHm(h, m);
    }
  }
  return '';
}

function parseKoreanDateStr(raw, fallbackDate) {
  const s = String(raw || '').trim();
  const iso = s.match(/(20\d{2})[.-](\d{1,2})[.-](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  const year = (fallbackDate || '2026-01-01').slice(0, 4);
  const kor = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (kor) {
    return `${year}-${kor[1].padStart(2, '0')}-${kor[2].padStart(2, '0')}`;
  }
  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (slash) {
    return `${year}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  }
  return fallbackDate;
}

function splitAddressAndNote(rawLine) {
  const text = String(rawLine || '').trim();
  if (!text) return { address: '', addressNote: '' };
  const parenMatch = text.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch && parenMatch[1].trim().length >= 8) {
    return {
      address: parenMatch[1].trim(),
      addressNote: parenMatch[2].trim(),
    };
  }
  return { address: text, addressNote: '' };
}

function parseMilkrunDetailStops(blockLines) {
  const stops = [];
  let current = null;

  const flushStop = () => {
    if (!current) return;
    const rawAddr = current._addrLines.join(' ').trim();
    const { address, addressNote } = splitAddressAndNote(rawAddr);
    stops.push({
      stopType: current.stopType,
      time: current.time,
      placeName: current.placeName,
      tempBadge: current.tempBadge,
      palletBadge: current.palletBadge,
      address,
      addressNote,
      contactName: current.contactName,
      contactPhone: current.contactPhone,
      tempNotice: current.tempNotice,
    });
    current = null;
  };

  for (const rawLine of blockLines) {
    const line = rawLine.trim();
    if (!line) continue;

    const headerMatch = line.match(
      /^(상차|하차)\s*(\d{1,2}:\d{2}|\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?)\s*\|\s*(.+)$/
    );
    if (headerMatch) {
      flushStop();
      const parts = headerMatch[3].split('|').map((s) => s.trim()).filter(Boolean);
      const placeName = parts[0] || '';
      let tempBadge = '';
      let palletBadge = '';
      for (const p of parts.slice(1)) {
        if (/냉장|냉동|상온|°C|℃|\d+\s*도/i.test(p)) {
          tempBadge = tempBadge ? `${tempBadge} · ${p}` : p;
        } else if (/파렛|\d+\s*P\b/i.test(p)) {
          palletBadge = palletBadge ? `${palletBadge} · ${p}` : p;
        }
      }
      current = {
        stopType: headerMatch[1],
        time: normalizeTimeStr(headerMatch[2]),
        placeName,
        tempBadge,
        palletBadge,
        _addrLines: [],
        contactName: '',
        contactPhone: '',
        tempNotice: '',
      };
      continue;
    }

    if (!current) continue;

    // 온도/주의사항 라인 (☆☆냉장1도 상품 (0~5도 유지) ☆☆)
    if (/[☆★]/.test(line) || /유지\)/.test(line)) {
      const cleanedNotice = line.replace(/[☆★]/g, '').trim();
      if (cleanedNotice) {
        current.tempNotice = current.tempNotice
          ? `${current.tempNotice} / ${cleanedNotice}`
          : cleanedNotice;
      }
      continue;
    }

    // 담당자 및 전화번호 라인
    const contactMatch = line.match(
      /^(?:담당자?|연락처|문의)?\s*([가-힣a-zA-Z]{2,10})?\s*(01[016789][-\s]?\d{3,4}[-\s]?\d{4}|\d{2,4}-\d{3,4}-\d{4})/
    );
    if (contactMatch && (/담당|연락/.test(line) || /^01[016789]/.test(line))) {
      current.contactName = (contactMatch[1] || '').trim();
      current.contactPhone = (contactMatch[2] || '').trim();
      continue;
    }

    // 나머지 줄은 주소/진입 안내로 취급
    current._addrLines.push(line);
  }

  flushStop();
  return stops;
}

function matchDriverByNameOrPlate(driverName, plateNo, drivers, vehicles) {
  const cleanName = String(driverName || '').trim();
  if (cleanName) {
    const exact = drivers.find((d) => (d.name || '').trim() === cleanName);
    if (exact) return exact;
    const partial = drivers.find(
      (d) => (d.name || '').includes(cleanName) || cleanName.includes(d.name || '')
    );
    if (partial) return partial;
  }
  const cleanPlate = String(plateNo || '').replace(/\s+/g, '');
  if (cleanPlate) {
    const veh = vehicles.find(
      (v) => (v.plateNo || '').replace(/\s+/g, '') === cleanPlate
    );
    if (veh?.assignedDriverId) {
      return drivers.find((d) => d.id === veh.assignedDriverId) || null;
    }
  }
  return null;
}

function parseExcelLine(line, defaultWorkDate) {
  // 탭 구분 또는 2개 이상 공백 구분 지원
  const cols = line.includes('\t')
    ? line.split('\t').map((c) => c.trim())
    : line.trim().split(/\s{2,}/).map((c) => c.trim());

  if (cols.length < 4) return null;

  // 예: 303 | 11월 21일 | 정태광 | [용인3센터] | [대전1센터] | 대전88아1895 | 010-4171-8990 | 3호 | 11T | 1200 | 1도
  const fullText = cols.join(' ');
  const bracketMatches = fullText.match(/\[[^\]]+\]/g) || [];
  if (bracketMatches.length < 2 && !line.includes('\t')) return null;

  const dispatchNo = /^\d{2,5}$/.test(cols[0]) ? cols[0] : '';
  let workDate = defaultWorkDate;
  let driverName = '';
  let origin = '';
  let dest = '';
  let plateNo = '';
  let unitNo = '';
  let tonnage = '';
  let loadTime = '';
  let tempInfo = '';

  cols.forEach((col, idx) => {
    if (!col) return;
    if (idx === 0 && /^\d{2,5}$/.test(col)) return;
    if (/(\d{1,2}\s*월\s*\d{1,2}\s*일?|20\d{2}[.-]\d{1,2}[.-]\d{1,2})/.test(col)) {
      workDate = parseKoreanDateStr(col, defaultWorkDate);
      return;
    }
    if (/^\[.+\]$/.test(col)) {
      const cleanCenter = col.replace(/^\[|\]$/g, '').trim();
      if (!origin) origin = cleanCenter;
      else if (!dest) dest = cleanCenter;
      return;
    }
    if (/^\d{2,3}[가-힣]\d{4}$|^[가-힣]{2}\d{2}[가-힣]\d{4}$/.test(col.replace(/\s+/g, ''))) {
      plateNo = col.replace(/\s+/g, '');
      return;
    }
    if (/^01[016789][-\s]?\d{3,4}[-\s]?\d{4}$/.test(col)) {
      return;
    }
    if (/^\d+호$/.test(col)) {
      unitNo = col;
      return;
    }
    if (/^\d+(?:\.\d+)?\s*[tT톤]$/.test(col)) {
      tonnage = col.toUpperCase();
      return;
    }
    if (/^\d{4}$/.test(col) && normalizeTimeStr(col)) {
      loadTime = normalizeTimeStr(col);
      return;
    }
    if (/^(?:냉장|냉동|상온)?\s*-?\d+(?:\.\d+)?\s*도$/.test(col)) {
      tempInfo = /냉장|냉동|상온/.test(col) ? col : `냉장 ${col}`;
      return;
    }
    if (!driverName && /^[가-힣]{2,4}$/.test(col)) {
      driverName = col;
    }
  });

  if (!origin || !dest || (!driverName && !plateNo)) return null;

  const cargoParts = [unitNo, tonnage].filter(Boolean);
  const cargoInfo = cargoParts.join(' · ');
  const dispatchTag = [
    dispatchNo ? `간선 ${dispatchNo}번` : '간선 배차',
    cargoInfo ? `(${cargoInfo})` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    sourceType: 'excel',
    workDate,
    driverName,
    plateNo,
    dispatchTag,
    milkrunNo: '',
    clientName: dest.includes('센터') || origin.includes('센터') ? '간선 센터운송' : `${origin}→${dest}`,
    courseName: `[${origin}] → [${dest}]`,
    supplyAmount: 0,
    invoiceType: 'bundled',
    cargoInfo: cargoInfo || '간선 센터',
    tempInfo: tempInfo || '',
    loadTime,
    unloadTime: '',
    stops: [
      {
        stopType: '상차',
        time: loadTime,
        placeName: origin,
        tempBadge: tempInfo,
        palletBadge: cargoInfo,
        address: '',
        addressNote: unitNo ? `배차 호수: ${unitNo}` : '',
        contactName: '',
        contactPhone: '',
        tempNotice: '',
      },
      {
        stopType: '하차',
        time: '',
        placeName: dest,
        tempBadge: '',
        palletBadge: '',
        address: '',
        addressNote: '',
        contactName: '',
        contactPhone: '',
        tempNotice: '',
      },
    ],
  };
}

function matchSummaryHeader(line) {
  const clean = String(line || '').trim();
  const withHonorific = clean.match(
    /^(?:밀크런\s*)?(\d+)\s*번\s*([가-힣]{2,4}?)\s*(?:기사님?|님)(?:\s+.*)?$/
  );
  if (withHonorific) {
    return { milkrunNo: withHonorific[1], driverName: withHonorific[2] };
  }
  const plain = clean.match(
    /^(?:밀크런\s*)?(\d+)\s*번\s*([가-힣]{2,4})(?:\s+.*)?$/
  );
  if (plain) {
    return { milkrunNo: plain[1], driverName: plain[2] };
  }
  return null;
}

function parseSummaryBlock(lines, milkrunDetailMap, defaultWorkDate) {
  const joined = lines.join('\n').trim();
  if (!joined) return null;

  const headerParsed = matchSummaryHeader(lines[0]);
  if (!headerParsed) return null;

  const { milkrunNo, driverName } = headerParsed;

  let supplyAmount = 0;
  let courseName = '';
  let cargoInfo = '';
  let tempInfo = '';
  let loadTime = '';
  let unloadTime = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 운임 추출: "17만", "19만원", "25만"
    const moneyMatch = line.match(/(\d+(?:\.\d+)?)\s*만(?:원)?/);
    if (moneyMatch && supplyAmount === 0) {
      supplyAmount = Math.round(parseFloat(moneyMatch[1]) * 10000);
    }

    // 구간 추출: "청주.증평 ㅡ 용인 17만"
    if (/[ㅡ\-—~→>]/.test(line) && !/^\d+시/.test(line) && !courseName) {
      const cleanedCourse = line
        .replace(/(\d+(?:\.\d+)?)\s*만(?:원)?/g, '')
        .replace(/\s*[ㅡ\-—~→>]+\s*/g, ' → ')
        .replace(/\./g, '·')
        .trim();
      if (cleanedCourse.includes('→')) {
        courseName = cleanedCourse;
      }
    }

    // 파렛트 정보
    const palletMatch = line.match(/(?:냉장|냉동|상온)?\s*\d+\s*파렛(?:트)?/);
    if (palletMatch && !cargoInfo) {
      cargoInfo = palletMatch[0].trim();
    }

    // 온도 정보
    const tempMatch = line.match(
      /-?\d+(?:\.\d+)?\s*도(?:\s*,\s*-?\d+(?:\.\d+)?\s*도)*/
    );
    if (tempMatch && !tempInfo) {
      tempInfo = tempMatch[0].replace(/\s+/g, '');
    }

    // 하차 시각: "11시30분하차", "14시10분하차"
    const unloadMatch = line.match(
      /(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?\s*하차/
    );
    if (unloadMatch && !unloadTime) {
      unloadTime = formatHm(unloadMatch[1], unloadMatch[2] || '0');
    }

    // 상차 시각 (하차가 붙지 않은 시간)
    const withoutUnload = line.replace(
      /(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?\s*하차/g,
      ''
    );
    const loadMatch = withoutUnload.match(
      /(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?|(\d{1,2}):(\d{2})/
    );
    if (loadMatch && !loadTime) {
      loadTime = loadMatch[1]
        ? formatHm(loadMatch[1], loadMatch[2] || '0')
        : formatHm(loadMatch[3], loadMatch[4]);
    }
  }

  const detail = milkrunDetailMap[milkrunNo] || null;
  let stops = [];
  if (detail && detail.stops.length > 0) {
    stops = detail.stops;
    if (detail.summaryCargo && (!cargoInfo || detail.summaryCargo.includes('총'))) {
      cargoInfo = detail.summaryCargo;
    }
    const firstStopTime = detail.stops.find((s) => s.stopType === '상차')?.time;
    const lastStopTime = [...detail.stops]
      .reverse()
      .find((s) => s.stopType === '하차')?.time;
    if (!loadTime && firstStopTime) loadTime = firstStopTime;
    if (!unloadTime && lastStopTime) unloadTime = lastStopTime;
  } else if (courseName) {
    const [fromLoc, toLoc] = courseName.split('→').map((s) => s.trim());
    stops = [
      {
        stopType: '상차',
        time: loadTime,
        placeName: fromLoc || courseName,
        tempBadge: tempInfo,
        palletBadge: cargoInfo,
        address: '',
        addressNote: '',
        contactName: '',
        contactPhone: '',
        tempNotice: '',
      },
      {
        stopType: '하차',
        time: unloadTime,
        placeName: toLoc || '도착지',
        tempBadge: '',
        palletBadge: '',
        address: '',
        addressNote: '',
        contactName: '',
        contactPhone: '',
        tempNotice: '',
      },
    ];
  }

  const lastUnload = [...stops].reverse().find((s) => s.stopType === '하차');
  const firstLoad = stops.find((s) => s.stopType === '상차');
  const defaultClient =
    lastUnload?.placeName ||
    firstLoad?.placeName ||
    `밀크런 ${milkrunNo}번`;

  return {
    sourceType: 'milkrun',
    workDate: defaultWorkDate,
    driverName,
    plateNo: '',
    milkrunNo,
    dispatchTag: `밀크런 ${milkrunNo}번`,
    clientName: defaultClient,
    courseName: courseName || `밀크런 ${milkrunNo}번`,
    supplyAmount,
    invoiceType: 'per_trip',
    cargoInfo,
    tempInfo,
    loadTime,
    unloadTime,
    stops,
    _matchedDetailNo: detail ? milkrunNo : '',
  };
}

export function parseKakaoAndExcelDispatch({
  rawText,
  defaultWorkDate,
  drivers = [],
  vehicles = [],
}) {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');

  // 1) Pass 1: '> 밀크런 N번 ...' 상세 블록 먼저 분리 추출
  const milkrunDetailMap = {};
  const consumedLineIdx = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const detailHeader = line.match(
      /^>?\s*밀크런\s*(\d+)\s*번(?:\s*[/|]\s*(.+))?$/
    );
    if (!detailHeader) continue;

    const milkrunNo = detailHeader[1];
    const summaryCargo = (detailHeader[2] || '').trim();
    consumedLineIdx.add(i);

    const blockLines = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const nextTrim = lines[j].trim();
      const isNextDetail = /^>?\s*밀크런\s*\d+\s*번/.test(nextTrim);
      const isNextSummary = Boolean(matchSummaryHeader(nextTrim));
      const isExcelRow =
        nextTrim.includes('\t') ||
        (/\[[^\]]+\]/.test(nextTrim) && /\d{2,5}/.test(nextTrim));
      if (isNextDetail || isNextSummary || isExcelRow) {
        i = j - 1;
        break;
      }
      consumedLineIdx.add(j);
      blockLines.push(lines[j]);
      if (j === lines.length - 1) i = j;
    }

    const stops = parseMilkrunDetailStops(blockLines);
    if (stops.length > 0) {
      milkrunDetailMap[milkrunNo] = {
        milkrunNo,
        summaryCargo,
        stops,
      };
    }
  }

  // 2) Pass 2 & 3: 남은 줄에서 엑셀 배차표 행 및 단톡방 요약 블록 추출
  const parsedTrips = [];
  const usedDetailNos = new Set();

  let curSummaryLines = [];
  const flushSummary = () => {
    if (curSummaryLines.length === 0) return;
    const item = parseSummaryBlock(
      curSummaryLines,
      milkrunDetailMap,
      defaultWorkDate
    );
    if (item) {
      if (item._matchedDetailNo) usedDetailNos.add(item._matchedDetailNo);
      parsedTrips.push(item);
    }
    curSummaryLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    if (consumedLineIdx.has(i)) continue;
    const line = lines[i].trim();

    if (!line) {
      flushSummary();
      continue;
    }

    const maybeExcel =
      line.includes('\t') ||
      ((line.match(/\[[^\]]+\]/g) || []).length >= 2 &&
        /\d{2,5}/.test(line));
    if (maybeExcel) {
      const excelItem = parseExcelLine(lines[i], defaultWorkDate);
      if (excelItem) {
        flushSummary();
        parsedTrips.push(excelItem);
        continue;
      }
    }

    if (matchSummaryHeader(line)) {
      flushSummary();
      curSummaryLines.push(line);
      continue;
    }

    if (curSummaryLines.length > 0) {
      curSummaryLines.push(line);
    }
  }
  flushSummary();

  // 매칭된 상세 블록 기록 외에 단독으로 붙여넣은 밀크런 상세 블록 수집
  const unmatchedMilkruns = Object.values(milkrunDetailMap).filter(
    (d) => !usedDetailNos.has(d.milkrunNo)
  );

  // 3) Pass 4: (workDate + driverKey) 기준으로 기사별 그룹화 & 시간순 1코스/2코스/3코스 정렬
  const groupMap = {};
  parsedTrips.forEach((rawItem) => {
    const matchedDriver = matchDriverByNameOrPlate(
      rawItem.driverName,
      rawItem.plateNo,
      drivers,
      vehicles
    );
    const driverId = matchedDriver?.id || `unmatched_${rawItem.driverName || rawItem.plateNo}`;
    const driverName = matchedDriver?.name || rawItem.driverName || '기사 미매칭';
    const veh = matchedDriver?.assignedVehicleId
      ? vehicles.find((v) => v.id === matchedDriver.assignedVehicleId)
      : null;
    const plateNo = rawItem.plateNo || veh?.plateNo || '-';
    const key = `${rawItem.workDate}__${driverId}`;

    if (!groupMap[key]) {
      groupMap[key] = {
        key,
        workDate: rawItem.workDate,
        driverId,
        isDriverMatched: Boolean(matchedDriver),
        driverName,
        plateNo,
        defaultRouteId: matchedDriver?.defaultRouteId || 'route_gansen',
        trips: [],
      };
    }

    const supply = Math.max(0, Math.round(Number(rawItem.supplyAmount) || 0));
    const vat = Math.round(supply * 0.1);
    groupMap[key].trips.push({
      clientName: rawItem.clientName,
      bizNo: '',
      courseName: rawItem.courseName,
      supplyAmount: supply,
      vatAmount: vat,
      totalAmount: supply + vat,
      invoiceType: rawItem.invoiceType,
      invoiceStatus: 'pending',
      invoiceIssuedAt: '',
      invoiceMemo: '',
      milkrunNo: rawItem.milkrunNo || '',
      dispatchTag: rawItem.dispatchTag || '',
      cargoInfo: rawItem.cargoInfo || '',
      tempInfo: rawItem.tempInfo || '',
      loadTime: rawItem.loadTime || '',
      unloadTime: rawItem.unloadTime || '',
      stops: rawItem.stops || [],
    });
  });

  const groups = Object.values(groupMap).map((grp) => {
    grp.trips.sort((a, b) =>
      (a.loadTime || '99:99').localeCompare(b.loadTime || '99:99')
    );
    grp.trips = grp.trips.map((t, idx) => ({ ...t, tripNo: idx + 1 }));
    return grp;
  });

  return {
    groups,
    unmatchedMilkruns,
  };
}

export function buildTripFromUnmatchedMilkrun(detail) {
  const stops = detail?.stops || [];
  const firstLoad = stops.find((s) => s.stopType === '상차');
  const lastUnload = [...stops].reverse().find((s) => s.stopType === '하차');
  const temps = Array.from(
    new Set(stops.map((s) => s.tempBadge).filter(Boolean))
  ).join(', ');
  return {
    clientName: lastUnload?.placeName || firstLoad?.placeName || `밀크런 ${detail.milkrunNo}번`,
    bizNo: '',
    courseName:
      firstLoad && lastUnload
        ? `${firstLoad.placeName} → ${lastUnload.placeName}`
        : `밀크런 ${detail.milkrunNo}번`,
    supplyAmount: 0,
    vatAmount: 0,
    totalAmount: 0,
    invoiceType: 'per_trip',
    invoiceStatus: 'pending',
    invoiceIssuedAt: '',
    invoiceMemo: '',
    milkrunNo: detail.milkrunNo,
    dispatchTag: `밀크런 ${detail.milkrunNo}번`,
    cargoInfo: detail.summaryCargo || '',
    tempInfo: temps,
    loadTime: firstLoad?.time || '',
    unloadTime: lastUnload?.time || '',
    stops,
  };
}
