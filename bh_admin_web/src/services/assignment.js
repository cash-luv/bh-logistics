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
 * [관리자 4 & 6] 차량 목록 + 필터 + D-Day + 기사↔차량 트랜잭션 배정
 * ========================================================================== */
/* ============================================================================
 * 양방향 기사 ↔ 차량 배정 동기화 트랜잭션 헬퍼
 * - 모든 Firestore 읽기(tx.get)를 먼저 수행한 뒤 쓰기(tx.set)를 실행하여 트랜잭션 오류를 방지합니다.
 * ========================================================================== */
export async function syncVehicleDriverTx({ vehicleId, driverId }) {
  await runTransaction(db, async (tx) => {
    const vehRef = doc(db, 'Vehicles', vehicleId);
    const vehSnap = await tx.get(vehRef);
    const currentVeh = vehSnap.data() || {};

    let newDriver = null;
    const newDriverRef = driverId ? doc(db, 'Users', driverId) : null;
    if (newDriverRef) {
      const newDriverSnap = await tx.get(newDriverRef);
      newDriver = newDriverSnap.data() || {};
    }

    // 1) 이 차량에 기존 배정된 다른 기사가 있었다면 해제
    if (
      currentVeh.assignedDriverId &&
      currentVeh.assignedDriverId !== driverId
    ) {
      tx.set(
        doc(db, 'Users', currentVeh.assignedDriverId),
        { assignedVehicleId: null, updatedAt: serverTimestamp() },
        { merge: true }
      );
    }

    // 2) 공차(배정 해제)인 경우
    if (!driverId || !newDriverRef) {
      tx.set(
        vehRef,
        {
          assignedDriverId: null,
          assignedDriverName: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    // 3) 새로 선택한 기사가 기존에 다른 차량을 타고 있었다면 그 차량을 공차로 전환
    if (
      newDriver?.assignedVehicleId &&
      newDriver.assignedVehicleId !== vehicleId
    ) {
      tx.set(
        doc(db, 'Vehicles', newDriver.assignedVehicleId),
        {
          assignedDriverId: null,
          assignedDriverName: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    // 4) 새 기사 ↔ 차량 양방향 연결
    tx.set(
      newDriverRef,
      { assignedVehicleId: vehicleId, updatedAt: serverTimestamp() },
      { merge: true }
    );
    tx.set(
      vehRef,
      {
        assignedDriverId: driverId,
        assignedDriverName: newDriver?.name || '',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}


export async function syncDriverVehicleTx({ driverId, vehicleId }) {
  await runTransaction(db, async (tx) => {
    const driverRef = doc(db, 'Users', driverId);
    const driverSnap = await tx.get(driverRef);
    const currentDriver = driverSnap.data() || {};

    let newVeh = null;
    const newVehRef = vehicleId ? doc(db, 'Vehicles', vehicleId) : null;
    if (newVehRef) {
      const newVehSnap = await tx.get(newVehRef);
      newVeh = newVehSnap.data() || {};
    }

    // 1) 이 기사가 기존에 배정받았던 다른 차량이 있었다면 공차로 해제
    if (
      currentDriver.assignedVehicleId &&
      currentDriver.assignedVehicleId !== vehicleId
    ) {
      tx.set(
        doc(db, 'Vehicles', currentDriver.assignedVehicleId),
        {
          assignedDriverId: null,
          assignedDriverName: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    // 2) 차량 미배정 선택 시
    if (!vehicleId || !newVehRef) {
      tx.set(
        driverRef,
        { assignedVehicleId: null, updatedAt: serverTimestamp() },
        { merge: true }
      );
      return;
    }

    // 3) 새로 선택한 차량에 기존 기사가 있었다면 그 기사의 차량 배정 해제
    if (newVeh?.assignedDriverId && newVeh.assignedDriverId !== driverId) {
      tx.set(
        doc(db, 'Users', newVeh.assignedDriverId),
        { assignedVehicleId: null, updatedAt: serverTimestamp() },
        { merge: true }
      );
    }

    // 4) 기사 ↔ 새 차량 양방향 연결
    tx.set(
      driverRef,
      { assignedVehicleId: vehicleId, updatedAt: serverTimestamp() },
      { merge: true }
    );
    tx.set(
      newVehRef,
      {
        assignedDriverId: driverId,
        assignedDriverName: currentDriver.name || '',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}
