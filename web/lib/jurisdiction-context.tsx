'use client';
import { createContext, useContext } from 'react';

interface JurisdictionData {
  status: 'ready' | 'crawling' | 'not_found' | 'loading';
  id?: string;
  name?: string;
  state?: string;
  type?: string;
  children?: any[];
  progress?: { phase: string; total: number; completed: number };
  urlBase?: string;
}

const JurisdictionContext = createContext<JurisdictionData>({ status: 'loading' });

export function useJurisdiction() {
  return useContext(JurisdictionContext);
}

export { JurisdictionContext };
export type { JurisdictionData };
