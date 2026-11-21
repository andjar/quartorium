import { createContext } from 'react';

/** Rendered outputs of locked blocks: { outputs: {blockKey: html}, status } */
export const RenderContext = createContext({ outputs: {}, status: 'none' });
