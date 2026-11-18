// 한국 시간(KST) 날짜·시각 변환 및 금액·거리·D-Day 계산 유틸리티
export function formatCurrency(amount?: number | null): string {
  return `${(Number(amount) || 0).toLocaleString('ko-KR')}원`;
}

export function formatKm(km?: number | null): string {
  return `${(Number(km) || 0).toLocaleString('ko-KR')}km`;
}

export function calcDday(dueDateStr?: string | null): number | null {
  if (!dueDateStr) return null;
  const due = new Date(`${dueDateStr}T00:00:00+09:00`);
  if (isNaN(due.getTime())) return null;
  const now = new Date();
  const kstToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = due.getTime() - kstToday.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function formatKstTime(ts: any): string {
  if (!ts) return '-';
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function todayKstStr(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 1,000 단위 콤마 입력 서식화
export function formatNumberWithCommas(value: any): string {
  if (value === null || value === undefined || value === '') return '';
  const clean = String(value).replace(/[^0-9]/g, '');
  if (!clean) return '';
  return Number(clean).toLocaleString('ko-KR');
}

// 콤마 제거 후 정수 변환
export function parseNumberWithoutCommas(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  return Number(String(value).replace(/,/g, '')) || 0;
}
