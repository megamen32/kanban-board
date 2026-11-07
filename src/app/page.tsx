'use client';

import { KonturBoard } from '@/components/kontur/kontur-board';
import { AuthGate } from '@/components/auth/auth-gate';

export default function Home() {
  return (
    <AuthGate><KonturBoard /></AuthGate>
  );
}
