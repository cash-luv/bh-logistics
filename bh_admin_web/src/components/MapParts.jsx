import React, { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  runTransaction,
  GeoPoint,
  query,
  where,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { auth, db, storage, secondaryAuth } from '../firebase';
import {
  calcDday,
  formatKstTime,
  todayKstStr,
  formatNumberWithCommas,
  parseNumberWithoutCommas,
} from '../utils/format';


/* ============================================================================
 * 공통: GPS 이동 타임라인 빨간 선(Polyline) 지도 컴포넌트 (Leaflet 기반)
 * ========================================================================== */
export function RoutePolylineMap({ points }) {
  const mapContainerRef = React.useRef(null);
  const mapInstanceRef = React.useRef(null);

  useEffect(() => {
    const L = window.L;
    if (!L || !mapContainerRef.current) return;

    const validPts = (points || []).filter(
      (p) =>
        p &&
        typeof Number(p.lat) === 'number' &&
        !isNaN(Number(p.lat)) &&
        typeof Number(p.lng) === 'number' &&
        !isNaN(Number(p.lng))
    );

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    if (validPts.length === 0) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: false,
    });
    mapInstanceRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map);

    const latLngs = validPts.map((p) => [Number(p.lat), Number(p.lng)]);

    // 이동 경로를 굵은 빨간 선(#EF4444)으로 이어서 표시
    const polyline = L.polyline(latLngs, {
      color: '#EF4444',
      weight: 5,
      opacity: 0.9,
    }).addTo(map);

    // 출발 · 경유 · 도착 지점마다 원형 마커와 팝업 말풍선 표시
    validPts.forEach((pt, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === validPts.length - 1 && validPts.length > 1;
      const markerColor = isStart
        ? '#10B981'
        : isEnd
        ? '#1E5EFF'
        : '#EF4444';

      const marker = L.circleMarker([Number(pt.lat), Number(pt.lng)], {
        radius: isStart || isEnd ? 8 : 6,
        fillColor: markerColor,
        color: '#FFFFFF',
        weight: 2.5,
        fillOpacity: 1,
      }).addTo(map);

      marker.bindPopup(
        `<div style="font-size:12px;line-height:1.4">
          <b>[${pt.time || '-'} · ${pt.type || '이동'}]</b><br/>
          📍 ${pt.address || '위치 정보'}<br/>
          누적 거리: <b>${pt.cumKm ?? 0}km</b>
        </div>`
      );
    });

    if (latLngs.length === 1) {
      map.setView(latLngs[0], 15);
    } else {
      map.fitBounds(polyline.getBounds(), { padding: [28, 28] });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [points]);

  return (
    <div
      ref={mapContainerRef}
      className="w-full h-64 rounded-xl border border-indigo-200 overflow-hidden bg-slate-100 z-0"
    />
  );
}


/* ============================================================================
 * 공통: 시·구·동 주소 + 상세 지도 팝업 모달
 * ========================================================================== */
export function LocationDetailModal({ info, onClose }) {
  if (!info) return null;
  const { title, address, lat, lng, subtitle } = info;
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';
  const googleEmbedUrl = hasCoords
    ? `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`
    : null;
  const googleLinkUrl = hasCoords
    ? `https://www.google.com/maps?q=${lat},${lng}`
    : null;
  const naverMapUrl = hasCoords
    ? `https://map.naver.com/p/search/${encodeURIComponent(
        address || `${lat},${lng}`
      )}`
    : null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-6 z-50"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl p-6 max-w-2xl w-full space-y-4 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-bold text-[#1E5EFF]">{subtitle}</div>
            <h3 className="text-xl font-black mt-0.5">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-sm"
          >
            닫기
          </button>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
          <div className="text-base font-bold text-slate-900">
            📍 {address || '주소 정보 없음'}
          </div>
          {hasCoords && (
            <div className="text-xs text-slate-500">
              위도·경도 좌표: {lat.toFixed(6)}, {lng.toFixed(6)}
            </div>
          )}
        </div>

        {googleEmbedUrl && (
          <div className="rounded-xl overflow-hidden border border-slate-200 h-80">
            <iframe
              title="상세 위치 지도"
              src={googleEmbedUrl}
              className="w-full h-full border-0"
              loading="lazy"
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          {googleLinkUrl && (
            <a
              href={googleLinkUrl}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2.5 rounded-xl bg-[#1E5EFF] text-white font-bold text-sm"
            >
              구글 지도에서 보기 ↗
            </a>
          )}
          {naverMapUrl && (
            <a
              href={naverMapUrl}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm"
            >
              네이버 지도에서 보기 ↗
            </a>
          )}
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
