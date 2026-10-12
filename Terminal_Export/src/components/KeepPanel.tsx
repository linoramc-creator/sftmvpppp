import {createContext,useContext,useRef,type ReactNode} from 'react';
const Activity=createContext(true);
export const usePanelActive=()=>useContext(Activity);
export default function KeepPanel({active,children}:{active:boolean;children:ReactNode}){
 const parentActive=usePanelActive();
 const visited=useRef(false);if(active)visited.current=true;
 return visited.current?<Activity.Provider value={active&&parentActive}><div hidden={!active} aria-hidden={!active}>{children}</div></Activity.Provider>:null;
}
