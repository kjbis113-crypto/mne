"use client";
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';

const wrap=(n:number)=>(n%360+360)%360;
export function Dial({value,labels,onChange,onPoint,destination,label='나침반 돌리기'}:{value:number;labels:readonly string[];onChange:(n:number)=>void;onPoint?:()=>void;destination?:string;label?:string}) {
  const step=360/labels.length;
  const [angle,setAngle]=useState(value*step+17),[dragging,setDragging]=useState(false),[leaving,setLeaving]=useState(false);
  const [ray,setRay]=useState<{x:number;y:number;angle:number;length:number;endX:number;endY:number}|null>(null);
  const gesture=useRef<{id:number;x:number;y:number;last:number;angle:number}|null>(null);
  const camera=useRef<HTMLDivElement>(null),surface=useRef<HTMLElement|null>(null);
  const completion=useRef({onPoint,destination});
  useEffect(()=>{completion.current={onPoint,destination};},[onPoint,destination]);
  useEffect(()=>{if(!gesture.current)setAngle(a=>a+wrap(value*step+17-a+180)-180);},[value,step]);
  useEffect(()=>{
    if(!ray||!camera.current||!surface.current)return;
    const main=surface.current,world=camera.current,box=main.getBoundingClientRect();
    const wasInert=main.inert;main.inert=true;main.classList.add('camera-flying');
    const center={x:innerWidth/2,y:innerHeight/2};
    // Both planes share a camera origin at the clicked point. A dolly towards
    // the line endpoint keeps the line and the real page in the same space.
    const frame=(progress:number,offset:number)=>{
      const zoom=1+progress*1.2;
      const x=(center.x-ray.x)*progress-(ray.endX-ray.x)*zoom*progress;
      const y=(center.y-ray.y)*progress-(ray.endY-ray.y)*zoom*progress;
      return {offset,transform:`translate3d(${x}px,${y}px,0) scale(${zoom})`};
    };
    const frames=[frame(0,0),frame(0,.24),frame(.42,.66),frame(1,1)];
    const timing:KeyframeAnimationOptions={duration:1800,easing:'cubic-bezier(.45,0,.15,1)',fill:'forwards'};
    const animations=[
      main.animate(frames.map(f=>({...f,transformOrigin:`${ray.x-box.left}px ${ray.y-box.top}px`})),timing),
      world.animate(frames.map(f=>({...f,transformOrigin:`${ray.x}px ${ray.y}px`})),timing),
    ];
    let restored=false;
    const restore=()=>{if(restored)return;restored=true;animations.forEach(a=>a.cancel());main.inert=wasInert;main.classList.remove('camera-flying');};
    const prevent=(e:Event)=>e.preventDefault();
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setRay(null);setLeaving(false);}else if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key))e.preventDefault();};
    window.addEventListener('wheel',prevent,{passive:false});window.addEventListener('touchmove',prevent,{passive:false});window.addEventListener('keydown',escape);
    const timer=setTimeout(()=>{
      const next=completion.current;
      if(next.destination){try{sessionStorage.setItem('mne-compass-arrival','1');}catch{}window.location.assign(next.destination);}
      else{restore();setRay(null);setLeaving(false);next.onPoint?.();}
    },1850);
    return()=>{clearTimeout(timer);restore();window.removeEventListener('wheel',prevent);window.removeEventListener('touchmove',prevent);window.removeEventListener('keydown',escape);};
  },[ray]);
  function end(){gesture.current=null;setDragging(false);}
  function launch(button:HTMLButtonElement){
    if(leaving||(!onPoint&&!destination))return;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){if(destination)window.location.assign(destination);else onPoint?.();return;}
    const b=button.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,heading=angle-90,length=Math.hypot(innerWidth,innerHeight)*.85;
    surface.current=button.closest('main');
    setRay({x,y,angle:heading,length,endX:x+Math.cos(heading*Math.PI/180)*length,endY:y+Math.sin(heading*Math.PI/180)*length});setLeaving(true);
  }
  return <div className={'dial '+(dragging?'dial-dragging ':'')+(leaving?'dial-leaving':'')}>
    <div className="dial-rotator" role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={labels.length-1} aria-valuenow={value} aria-valuetext={labels[value]}
      onPointerDown={e=>{if(leaving||e.button!==0)return;const b=e.currentTarget.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;gesture.current={id:e.pointerId,x,y,last:Math.atan2(e.clientY-y,e.clientX-x)*180/Math.PI,angle};e.currentTarget.setPointerCapture(e.pointerId);setDragging(true);}}
      onPointerMove={e=>{const g=gesture.current;if(!g||g.id!==e.pointerId)return;const a=Math.atan2(e.clientY-g.y,e.clientX-g.x)*180/Math.PI;g.angle+=wrap(a-g.last+180)-180;g.last=a;setAngle(g.angle);onChange(Math.round(wrap(g.angle-17)/step)%labels.length);}}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onKeyDown={e=>{let n=value;if(['ArrowRight','ArrowDown'].includes(e.key))n=(value+1)%labels.length;else if(['ArrowLeft','ArrowUp'].includes(e.key))n=(value+labels.length-1)%labels.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=labels.length-1;else return;e.preventDefault();onChange(n);}}>
      <svg viewBox="0 0 328 328" aria-hidden="true">
        <circle cx="164" cy="164" r="31" className="dial-disc"/>
        <path d="M120 164h88M164 120v88" className="dial-cross"/>
        <g style={{transform:`rotate(${angle}deg)`,transformOrigin:'164px 164px'}} className="dial-ring">
          {Array.from({length:120},(_,i)=><line key={i} x1="164" y1="70" x2="164" y2={i%5===0?86:83} transform={`rotate(${i*3} 164 164)`} className={i%5===0?'dial-tick major':'dial-tick'}/>)}
          {['N','E','S','W'].map((letter,i)=><text key={letter} x={164+70*Math.sin(i*Math.PI/2)} y={171-70*Math.cos(i*Math.PI/2)} textAnchor="middle">{letter}</text>)}
        </g>
        <path d="M164 42v43" className="dial-north"/>
      </svg>
    </div>
    {(onPoint||destination)&&<div className="dial-pointer-orbit" style={{transform:`rotate(${angle}deg)`}}><button className="dial-pointer" aria-label="이 방향으로 주문하러 가기" disabled={leaving} onClick={e=>launch(e.currentTarget)}><span/></button></div>}
    {ray&&createPortal(<div className="compass-flight" aria-hidden="true"><div className="flight-paper"/><div className="flight-camera" ref={camera}><div className="compass-ray" style={{left:ray.x,top:ray.y,width:ray.length,transform:`rotate(${ray.angle}deg)`} as CSSProperties}><i/></div><div className="flight-destination" style={{left:ray.endX,top:ray.endY}}><span style={{transform:`rotate(${ray.angle+90}deg)`}}/></div></div></div>,document.body)}
  </div>;
}
