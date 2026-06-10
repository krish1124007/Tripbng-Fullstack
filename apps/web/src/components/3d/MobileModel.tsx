'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, ContactShadows, PresentationControls, Environment } from '@react-three/drei';
import * as THREE from 'three';

export function MobileModel(props: any) {
  const group = useRef<THREE.Group>(null);
  
  return (
    <group ref={group} {...props} dispose={null}>
      {/* Phone Body */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.5, 3, 0.1]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.3} metalness={0.8} />
      </mesh>
      
      {/* Screen Inner (Black) */}
      <mesh position={[0, 0, 0.051]}>
        <planeGeometry args={[1.4, 2.9]} />
        <meshBasicMaterial color="black" />
      </mesh>

      {/* HTML UI overlaid on the screen */}
      <Html
        transform
        wrapperClass="mobile-screen-html"
        distanceFactor={1.5}
        position={[0, 0, 0.052]}
        rotation={[0, 0, 0]}
      >
        <div
          className="w-[375px] h-[775px] overflow-hidden rounded-3xl bg-zinc-950 pointer-events-none flex flex-col items-center justify-center border-4 border-zinc-900 shadow-xl"
          style={{
            transform: 'scale(0.373)',
            transformOrigin: 'center center',
          }}
        >
          <div className="w-16 h-1 rounded-full bg-zinc-800 absolute top-4"></div>
          <div className="flex flex-col items-center gap-4 text-center p-8">
            <div className="w-16 h-16 rounded-full bg-brand-500 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/>
                <path d="M12 18h.01"/>
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-white">TripBng Mobile</h3>
            <p className="text-zinc-400">Your counter, in your pocket.</p>
            <div className="w-full h-32 rounded-xl bg-zinc-900 mt-8 border border-zinc-800 p-4 flex flex-col gap-3">
              <div className="w-full h-4 rounded bg-zinc-800"></div>
              <div className="w-3/4 h-4 rounded bg-zinc-800"></div>
              <div className="w-1/2 h-4 rounded bg-zinc-800"></div>
            </div>
          </div>
        </div>
      </Html>
    </group>
  );
}

export function MobileScene() {
  return (
    <PresentationControls
      global
      rotation={[0, -0.3, 0]}
      polar={[-0.2, 0.2]}
      azimuth={[-0.5, 0.5]}
      config={{ mass: 2, tension: 400 }}
      snap={{ mass: 4, tension: 400 }}
    >
      <MobileModel position={[0, 0, 0]} />
      <ContactShadows position={[0, -1.6, 0]} opacity={0.5} scale={10} blur={2} far={4} />
      <Environment preset="city" />
    </PresentationControls>
  );
}
