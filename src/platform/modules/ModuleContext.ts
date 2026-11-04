import {createContext,useContext} from 'react';
import type {BusinessModuleManifest,ModuleGrant,ModuleAccess} from './contracts';
export type ModuleRuntime={manifest:BusinessModuleManifest;grant:ModuleGrant;access:ModuleAccess};
export const ModuleContext=createContext<ModuleRuntime|null>(null);
export const useBusinessModule=()=>useContext(ModuleContext);
