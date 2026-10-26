import {useCallback,useRef,useState,type Dispatch,type SetStateAction} from 'react'
import {defaultPresentation,readPresentation,type Presentation} from './presentation'
export function usePresentation(experimentId:string) {
 const key=`qpcr-presentation-v1:${experimentId}`
 const [presentation,setState]=useState<Presentation>(()=>{try{return readPresentation(JSON.parse(localStorage.getItem(key)??'null'))}catch{return defaultPresentation()}})
 const current=useRef(presentation),previous=useRef<Presentation|null>(null)
 const [canUndoPresentation,setCanUndo]=useState(false)
 const [storageNotice,setStorageNotice]=useState('')
 const setPresentation:Dispatch<SetStateAction<Presentation>>=useCallback(update=>{
  const base=current.current.plotDefaults&&current.current.plotOverrides?current.current:readPresentation(current.current)
  const next=typeof update==='function'?update(base):update
  previous.current=base;current.current=next;setState(next);setCanUndo(true)
  try{localStorage.setItem(key,JSON.stringify(next));setStorageNotice('')}catch{setStorageNotice('Appearance is kept for this session; browser storage is unavailable.')}
 },[key])
 const undoPresentation=useCallback(()=>{if(!previous.current)return;const next=readPresentation(previous.current);previous.current=null;current.current=next;setState(next);setCanUndo(false);try{localStorage.setItem(key,JSON.stringify(next));setStorageNotice('')}catch{setStorageNotice('Appearance is kept for this session; browser storage is unavailable.')}},[key])
 return {presentation:presentation.plotDefaults&&presentation.plotOverrides?presentation:readPresentation(presentation),setPresentation,storageNotice,canUndoPresentation,undoPresentation}
}
