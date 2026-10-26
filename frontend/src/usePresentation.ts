import {useCallback,useRef,useState,type Dispatch,type SetStateAction} from 'react'
import {defaultPresentation,readPresentation,type Presentation} from './presentation'
export function usePresentation(experimentId:string) {
 const key=`qpcr-presentation-v1:${experimentId}`
 const [presentation,setState]=useState<Presentation>(()=>{try{return readPresentation(JSON.parse(localStorage.getItem(key)??'null'))}catch{return defaultPresentation()}})
 const current=useRef(presentation)
 const [storageNotice,setStorageNotice]=useState('')
 const setPresentation:Dispatch<SetStateAction<Presentation>>=useCallback(update=>{
  const next=typeof update==='function'?update(current.current):update
  current.current=next;setState(next)
  try{localStorage.setItem(key,JSON.stringify(next));setStorageNotice('')}catch{setStorageNotice('Appearance is kept for this session; browser storage is unavailable.')}
 },[key])
 return {presentation,setPresentation,storageNotice}
}
