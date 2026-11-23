import { createContext, useContext, type ReactNode } from 'react';

export const ReaderLedeContext = createContext<ReactNode>(null);
export const ReaderTailContext = createContext<ReactNode>(null);

export function ReaderLede() {
  return <>{useContext(ReaderLedeContext)}</>;
}

export function ReaderTail() {
  return <>{useContext(ReaderTailContext)}</>;
}
