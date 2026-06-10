'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, Html, ContactShadows, PresentationControls, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { FauxDashboard } from '@/app/(marketing)/_components/faux-dashboard';

export function LaptopModel(props: any) {
  const group = useRef<THREE.Group>(null);
  
  // We'll create a stylized laptop using Three.js primitives since we don't have a GLTF
  return (
    <group ref={group} {...props} dispose={null}>
      {/* Base */}
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[3, 0.1, 2]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.5} metalness={0.5} />
      </mesh>
      
      {/* Keyboard area indentation */}
      <mesh position={[0, 0.01, 0.2]}>
        <boxGeometry args={[2.8, 0.01, 1]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      
      {/* Trackpad */}
      <mesh position={[0, 0.01, 0.8]}>
        <boxGeometry args={[0.8, 0.01, 0.3]} />
        <meshStandardMaterial color="#222" />
      </mesh>

      {/* Screen Hinge */}
      <mesh position={[0, 0, -0.95]}>
        <cylinderGeometry args={[0.05, 0.05, 2.9, 32]} rotation={[0, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#111" />
      </mesh>

      {/* Screen */}
      <group position={[0, 0.05, -0.95]} rotation={[-0.2, 0, 0]}>
        {/* Screen Bezel */}
        <mesh position={[0, 1, 0]}>
          <boxGeometry args={[3, 2, 0.05]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.5} metalness={0.5} />
        </mesh>
        
        {/* Screen Inner (Black) */}
        <mesh position={[0, 1, 0.026]}>
          <planeGeometry args={[2.8, 1.8]} />
          <meshBasicMaterial color="black" />
        </mesh>

        {/* HTML UI overlaid on the screen */}
        <Html
          transform
          wrapperClass="laptop-screen-html"
          distanceFactor={1.5}
          position={[0, 1, 0.027]}
          rotation={[0, 0, 0]}
        >
          <div
            className="w-[1024px] h-[658px] overflow-hidden rounded-md bg-white pointer-events-none"
            style={{
              transform: 'scale(0.273)',
              transformOrigin: 'center center',
            }}
          >
            <FauxDashboard />
          </div>
        </Html>
      </group>
    </group>
  );
}

export function LaptopScene() {
  return (
    <PresentationControls
      global
      rotation={[0.13, 0.1, 0]}
      polar={[-0.4, 0.2]}
      azimuth={[-1, 0.75]}
      config={{ mass: 2, tension: 400 }}
      snap={{ mass: 4, tension: 400 }}
    >
      <LaptopModel position={[0, -1, 0]} />
      <ContactShadows position={[0, -1.1, 0]} opacity={0.5} scale={10} blur={2} far={4} />
      <Environment preset="city" />
    </PresentationControls>
  );
}
