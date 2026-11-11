import {createContext,useContext,useRef,type ReactNode} from 'react';
const Activity=createContext(true);
export const usePanelActive=()=>useContext(Activity);
export default function KeepPanel({active,preload=false,children}:{active:boolean;preload?:boolean;children:ReactNode}){
 const parentActive=usePanelActive();
 const visited=useRef(false);if(active||preload)visited.current=true;
 return visited.current?<Activity.Provider value={(active||preload)&&parentActive}><div hidden={!active} aria-hidden={!active}>{children}</div></Activity.Provider>:null;
}
