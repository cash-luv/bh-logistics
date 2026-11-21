import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  VertexAIBackend,
} from 'firebase/ai';
import { app } from '../firebase';
import { buildDriverGroupsFromRawTrips } from '../utils/dispatchParser';

export function fileToImagePart(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const commaIdx = dataUrl.indexOf(',');
      const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
      resolve({
        mimeType: file.type || 'image/png',
        base64,
        previewUrl: dataUrl,
        name: file.name || 'clipboard_image.png',
      });
    };
    reader.onerror = () => reject(new Error('이미지 파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

function buildDispatchPrompt({
  rawText,
  defaultWorkDate,
  defaultClientName,
  defaultDispatchCategory,
  drivers,
  vehicles,
}) {
  const driverHints = drivers
    .map((d) => {
      const veh = vehicles.find((v) => v.id === d.assignedVehicleId);
      return `${d.name}${veh?.plateNo ? `(${veh.plateNo})` : ''}`;
    })
    .join(', ');

  return `당신은 대한민국 화물운송회사(BH로지스틱스)의 전문 배차·정산 분석 AI입니다.
첨부된 모든 배차표 이미지(엑셀 캡처, 밀크런 상세표 캡처 등)와 아래 텍스트(카카오톡 요약·상세·엑셀 복사)를 **서로 비교·교차 검증하여 하나로 합친 뒤** JSON으로만 출력하세요.

[기본 기준 정보]
- 기본 운행일자: ${defaultWorkDate} (텍스트나 표에 '11월 21일' 같은 날짜가 있으면 ${defaultWorkDate.slice(0, 4)}-MM-DD 형식으로 변환)
- 기본 배차 구분: ${defaultDispatchCategory} ('fixed_gansen' = 고정 간선 원청 1곳 묶음 발행 / 'spot_charter' = 외부 용차 단발 콜 건별 1장)
- 고정 간선 원청 거래처명: ${defaultClientName}
- 우리 회사 기사(차량번호) 목록: ${driverHints || '정보 없음'}

[분석 규칙 - 매우 중요]
1. 카카오톡 요약글(예: "6번 정태광님 / 청주.증평 ㅡ 용인 17만")과 상세 이미지/텍스트("> 밀크런 6번 ... 상차 9:00 | JV ONESWILL ...")가 있으면 **밀크런 번호(6번 등)로 서로 연결**하여 하나의 코스에 운임(17만 -> 170000)과 상·하차 상세 주소·담당자·연락처·온도를 모두 합치세요.
2. 엑셀 배차표(예: "303 | 11월 21일 | 정태광 | [용인3센터] | [대전1센터] | 1200 | 1도") 행들도 빠짐없이 모두 추출해 같은 기사의 다음 코스(2코스, 3코스...)로 만드세요. 시간 '1200'은 '12:00', '1430'은 '14:30', '9시'는 '09:00' 형식으로 정규화하세요.
3. **거래처(clientName) 분류 규칙**:
   - 기본 배차 구분이 'fixed_gansen'이거나 고정 원청의 밀크런·센터 간선 운행이면, 상·하차 장소명('신선용인3', '에르코스', 'JV ONESWILL', '용인3센터' 등)을 거래처명으로 쓰지 말고 반드시 clientName에 "${defaultClientName}"을 넣고 dispatchCategory="fixed_gansen"으로 지정하세요.
   - 만약 단발성 외부 용차 콜이 명확히 섞여 있다면 dispatchCategory="spot_charter"로 하고 외부 주선/화주사 이름을 clientName에 넣으세요.
4. 주소에서 괄호 안의 진입/층수 안내(예: "(지하 1층)", "(중부로 2641 주유소 쪽으로 진입)")는 가능하면 addressNote로 분리하고 도로명 주소만 address에 깔끔하게 담으세요.
5. 기사 이름은 위 목록과 최대한 정확히 일치시키세요. 금액("17만", "19만")은 원 단위 정수(170000, 190000)로 변환하세요. 금액 정보가 없으면 0으로 두세요.

[출력 JSON 스키마 - 반드시 JSON 객체만 반환]
{
  "trips": [
    {
      "workDate": "YYYY-MM-DD",
      "driverName": "홍길동",
      "plateNo": "대전88아1895",
      "dispatchCategory": "fixed_gansen",
      "clientName": "${defaultClientName}",
      "courseName": "청주·증평 → 용인",
      "supplyAmount": 170000,
      "milkrunNo": "6",
      "dispatchTag": "밀크런 6번",
      "cargoInfo": "냉장 총 7파렛",
      "tempInfo": "1도,10도",
      "loadTime": "09:00",
      "unloadTime": "11:30",
      "stops": [
        {
          "stopType": "상차",
          "time": "09:00",
          "placeName": "JV ONESWILL",
          "tempBadge": "냉장(+10°C)",
          "palletBadge": "2파렛",
          "address": "충청북도 청주시 청원구 북이면 내수로 796-105",
          "addressNote": "",
          "contactName": "정한영",
          "contactPhone": "010-2336-4568",
          "tempNotice": "냉장10도 상품 (5~10도 유지)"
        }
      ]
    }
  ]
}

[입력된 텍스트]
${rawText ? rawText.trim() : '(텍스트 없음 — 첨부 이미지에서 모든 배차 정보를 읽어 추출하세요)'}`;
}

function extractJsonObject(text) {
  const cleaned = String(text || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI 응답에서 JSON 데이터를 찾지 못했습니다.');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callGeminiWithApiKey({ apiKey, promptText, images }) {
  const parts = [
    { text: promptText },
    ...images.map((img) => ({
      inlineData: {
        mimeType: img.mimeType || 'image/png',
        data: img.base64,
      },
    })),
  ];

  let lastErr = null;
  for (const modelName of ['gemini-2.5-flash', 'gemini-2.0-flash']) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(
      apiKey.trim()
    )}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (res.ok) {
      const json = await res.json();
      const text =
        json?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || '')
          .join('') || '';
      return text;
    }
    const errText = await res.text();
    lastErr = new Error(`${modelName} (${res.status}): ${errText.slice(0, 200)}`);
  }
  throw lastErr || new Error('Gemini API 호출 실패');
}

async function callFirebaseAI({ promptText, images }) {
  const parts = [
    { text: promptText },
    ...images.map((img) => ({
      inlineData: {
        mimeType: img.mimeType || 'image/png',
        data: img.base64,
      },
    })),
  ];

  const backends = [
    { label: 'VertexAI', backend: new VertexAIBackend() },
    { label: 'GoogleAI', backend: new GoogleAIBackend() },
  ];
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];

  let lastErr = null;
  for (const b of backends) {
    const ai = getAI(app, { backend: b.backend });
    for (const modelName of models) {
      try {
        const model = getGenerativeModel(ai, {
          model: modelName,
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        });
        const result = await model.generateContent(parts);
        return result.response.text();
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr || new Error('Firebase AI 호출 실패');
}

export async function analyzeDispatchWithAI({
  images = [],
  rawText = '',
  defaultWorkDate,
  defaultClientName = '고정 간선 원청',
  defaultDispatchCategory = 'fixed_gansen',
  drivers = [],
  vehicles = [],
  customApiKey = '',
}) {
  if (images.length === 0 && !rawText.trim()) {
    throw new Error('분석할 사진 또는 배차 텍스트를 먼저 넣어 주세요.');
  }

  const promptText = buildDispatchPrompt({
    rawText,
    defaultWorkDate,
    defaultClientName,
    defaultDispatchCategory,
    drivers,
    vehicles,
  });

  let rawResponse = '';
  const trimmedKey = String(customApiKey || '').trim();
  if (trimmedKey) {
    rawResponse = await callGeminiWithApiKey({
      apiKey: trimmedKey,
      promptText,
      images,
    });
  } else {
    try {
      rawResponse = await callFirebaseAI({ promptText, images });
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg.includes('genai-config-not-found') || msg.includes('genai config')) {
        throw new Error(
          'Firebase AI Logic 초기 설정이 아직 완료되지 않았습니다.\n' +
            '① Firebase 콘솔 → AI Logic 에서 [시작하기]를 1번 누르시거나,\n' +
            '② 아래 [⚙️ AI 키 설정]에 무료 Google AI Studio 키를 입력해 주세요.'
        );
      }
      throw err;
    }
  }

  const parsedJson = extractJsonObject(rawResponse);
  const rawTrips = Array.isArray(parsedJson?.trips) ? parsedJson.trips : [];
  if (rawTrips.length === 0) {
    throw new Error('AI가 배차 정보를 찾지 못했습니다. 사진이나 글이 선명한지 확인해 주세요.');
  }

  const groups = buildDriverGroupsFromRawTrips({
    parsedTrips: rawTrips,
    drivers,
    vehicles,
    defaultWorkDate,
    defaultClientName,
    defaultDispatchCategory,
  });

  return {
    groups,
    rawTripsCount: rawTrips.length,
  };
}
