"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { makeOrderDraft, NOTE_VALUES, PROCESS_STEPS, type OrderDraft } from "./order-contract";
import {Dial} from './dial';
import {Arrow, inlineArrows} from './arrow';
import {ArchitecturalBackground} from './architectural-background';
// Keep the existing copy contract, but present one Korean text block only.
export function Pair({ko,className=''}:{en:string;ko:string;className?:string}){return <span className={'pair '+className}><span lang="ko">{inlineArrows(ko)}</span></span>;}
const notes=[
  {en:'Fruity',ko:'프루티',description:'The brightness of fruit. A vivid, sweet impression.',translation:'과일의 생기와 선명하고 달콤한 인상.'},
  {en:'Floral',ko:'플로럴',description:'Soft petals, sunlit linen, a fleeting tenderness.',translation:'부드러운 꽃잎과 햇살을 머금은 리넨, 스쳐 가는 다정함.'},
  {en:'Fresh',ko:'프레시',description:'Open windows, distant water, a clean beginning.',translation:'열린 창과 멀리 흐르는 물, 맑고 산뜻한 시작.'},
  {en:'Woody',ko:'우디',description:'Dry wood, familiar rooms, the things that stay.',translation:'마른 나무와 익숙한 방, 오래 곁에 남는 것들.'},
  {en:'Balsamic',ko:'발사믹',description:'Resinous warmth, quiet depth, a lingering softness.',translation:'수지의 따뜻함과 고요한 깊이, 은은하게 남는 부드러움.'},
];
const memories=[
  {title:'A window left open',titleKo:'열어 둔 창',place:'Seoul',placeKo:'서울',family:3,description:'Cold rain entering a warm room. The quiet scent of cedar shelves and paper.',ko:'따뜻한 방 안으로 스며드는 찬 비. 삼나무 책장과 종이에서 번지는 고요한 향.',notes:'Wet stone · cedar · paper',notesKo:'젖은 돌 · 삼나무 · 종이',image:'/campaign-20261105-02.webp'},
  {title:'The last ferry',titleKo:'마지막 배',place:'Busan',placeKo:'부산',family:2,description:'Salt caught in a wool coat at dusk. We stayed on deck until the lights disappeared.',ko:'해 질 무렵, 모직 코트에 밴 소금기. 불빛이 사라질 때까지 우리는 갑판에 남아 있었다.',notes:'Sea salt · iris · musk',notesKo:'바다 소금 · 아이리스 · 머스크',image:'/campaign-20261105-06.webp'},
  {title:'Summer, 4:13 pm',titleKo:'여름, 오후 4시 13분',place:'Daegu',placeKo:'대구',family:0,description:'A peach split open above hot pavement. Nothing planned for the rest of the day.',ko:'뜨거운 보도 위에서 반으로 가른 복숭아. 남은 하루에는 아무 계획도 없었다.',notes:'White peach · hay · amber',notesKo:'백도 · 마른 풀 · 앰버',image:'/campaign-20261105-05.webp'},
  {title:'My mother’s drawer',titleKo:'엄마의 서랍',place:'Jeonju',placeKo:'전주',family:1,description:'Pressed linen and the powder left behind. A small drawer that held an entire childhood.',ko:'반듯하게 다린 리넨과 남아 있던 분 냄새. 어린 시절을 고스란히 담고 있던 작은 서랍.',notes:'Violet · cotton · orris',notesKo:'바이올렛 · 코튼 · 아이리스 뿌리',image:'/campaign-20261105-04.webp'},
  {title:'Mountain after dark',titleKo:'어둠이 내린 산',place:'Pyeongchang',placeKo:'평창',family:3,description:'Pine resin on our hands, smoke in our hair. The last light through the trees.',ko:'손에 묻은 송진, 머리카락에 밴 연기. 나무 사이로 스며들던 마지막 빛.',notes:'Pine · smoke · oakmoss',notesKo:'소나무 · 스모크 · 오크모스',image:'/campaign-20261105-02.webp'},
];
const processKo=['주문 정보가 접수됩니다.','향 분석을 통해 세 가지 후보 향과 배합 번호가 정해집니다.','세 가지 향의 시향지를 준비합니다.','시향지를 받아 각 향을 경험해 보세요.','원하는 향 하나를 선택합니다. 선택한 번호는 주문 비고에 기록됩니다.','선택한 향으로 완성한 향초를 보내 드립니다.','당신의 기억이 하나의 향초가 됩니다.'];
const errors:Record<string,string>={
  'Choose a JPG, PNG, WebP or GIF image.':'JPG, PNG, WebP 또는 GIF 이미지를 선택해 주세요.',
  'Please choose an image smaller than 4 MB.':'4MB 이하의 이미지를 선택해 주세요.',
  'Bring a photograph and a few words before continuing.':'사진과 기억에 대한 짧은 글을 먼저 입력해 주세요.',
  'Add a photograph.':'사진을 올려 주세요.',
  'Add a few words about your memory.':'기억에 대한 짧은 글을 입력해 주세요.',
  'Add your name and a contact detail to prepare your order.':'주문을 준비하려면 이름과 연락처를 입력해 주세요.',
  'Upload your own photograph. The sample image is for preview only.':'내 사진을 올려 주세요. 예시 이미지는 미리보기 전용입니다.',
  'We could not confirm the sheet entry. Retry with this same order reference to avoid a duplicate.':'접수 여부를 확인하지 못했습니다. 중복 접수를 막기 위해 같은 주문 번호로 다시 시도해 주세요.',
  'Please wait a minute before trying again.':'잠시 기다린 뒤 다시 시도해 주세요.',
};

type MemoryRecord = { title: string; place: string; memory: string; notes: string; family: string; image?: string };
const bearings = [
  { letter: "N", title: "Memory", titleKo:"기억", descriptionKo:"사진 한 장으로 시작하세요.", description: "Begin with a photograph.", key: "memory" },
  { letter: "E", title: "Scent", titleKo:"향", descriptionKo:"기억이 향하는 곳을 찾아보세요.", description: "Give your memory a direction.", key: "scent" },
  { letter: "S", title: "Candle", titleKo:"향초", descriptionKo:"손에 잡히는 기억.", description: "A memory, made tangible.", key: "candle" },
  { letter: "W", title: "Archive", titleKo:"아카이브", descriptionKo:"누군가의 공기.", description: "Someone else’s air.", key: "archive" },
] as const;
const families = [
  {name:"Fruity",words:"BRIGHT — JUICY — PLAYFUL",description:"The brightness of fruit. A vivid, sweet impression.",color:"#a7805e"},
  {name:"Floral",words:"PETALS — BLOOM — TENDERNESS",description:"Soft petals, sunlit linen, a fleeting tenderness.",color:"#8a777d"},
  {name:"Fresh",words:"AIR — WATER — OPEN SPACE",description:"Open windows, distant water, a clean beginning.",color:"#717e7e"},
  {name:"Woody",words:"WOOD — EARTH — STILLNESS",description:"Dry wood, familiar rooms, the things that stay.",color:"#655f4e"},
  {name:"Balsamic",words:"RESIN — WARMTH — DEPTH",description:"Resinous warmth, quiet depth, a lingering softness.",color:"#957354"},
] satisfies {name:typeof NOTE_VALUES[number];words:string;description:string;color:string}[];
const samples: MemoryRecord[] = [
  {title:"A window left open",place:"Seoul",memory:"Cold rain entering a warm room. The quiet scent of cedar shelves and paper.",notes:"Wet stone · cedar · paper",family:"Woody"},
  {title:"The last ferry",place:"Busan",memory:"Salt caught in a wool coat at dusk. We stayed on deck until the lights disappeared.",notes:"Sea salt · iris · musk",family:"Fresh"},
  {title:"Summer, 4:13 pm",place:"Daegu",memory:"A peach split open above hot pavement. Nothing planned for the rest of the day.",notes:"White peach · hay · amber",family:"Fruity"},
  {title:"My mother’s drawer",place:"Jeonju",memory:"Pressed linen and the powder left behind. A small drawer that held an entire childhood.",notes:"Violet · cotton · orris",family:"Floral"},
  {title:"Mountain after dark",place:"Pyeongchang",memory:"Pine resin on our hands, smoke in our hair. The last light through the trees.",notes:"Pine · smoke · oakmoss",family:"Woody"},
];
function InteractiveCompass({value,labels,onChange,label,onPoint}:{value:number;labels:readonly string[];onChange:(value:number)=>void;label:string;onPoint?:()=>void}){return <Dial value={value} labels={labels} onChange={onChange} label={label} onPoint={onPoint} destination={onPoint?undefined:'/order#memory'}/>;}
function jump(id:string) {document.getElementById(id)?.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"start"});}
export default function Home({orderPage=false}:{orderPage?:boolean}) {
  const [family,setFamily]=useState(0),[bearing,setBearing]=useState(0);
  const [photo,setPhoto]=useState(""),[memory,setMemory]=useState(""),[error,setError]=useState("");
  const [customerName,setCustomerName]=useState(""),[contact,setContact]=useState("");
  const [draft,setDraft]=useState<OrderDraft|null>(null);
  const [photoFile,setPhotoFile]=useState<File|null>(null),[connected,setConnected]=useState(false),[submitting,setSubmitting]=useState(false);
  const [receipt,setReceipt]=useState<{orderNumber:string;receivedAt:string}|null>(null),[submitError,setSubmitError]=useState("");
  const orderNumber=useRef("");
  const [records]=useState<MemoryRecord[]>(()=>samples.map((r,i)=>({...r,image:["/campaign-20261105-01.webp","/campaign-20261105-06.webp","/campaign-20261105-05.webp","/campaign-20261105-04.webp","/campaign-20261105-02.webp"][i]})));
  const [detail,setDetail]=useState<number|null>(null),[chapter,setChapter]=useState("home");
  const root=useRef<HTMLElement>(null),input=useRef<HTMLInputElement>(null),dialog=useRef<HTMLDialogElement>(null);
  const urls=useRef<string[]>([]);
  const recipe=families[family];
  const selected=detail===null?null:records[detail];
  useEffect(()=>{
    if(!orderPage)return;
    try{
      const arriving=sessionStorage.getItem('mne-compass-arrival');sessionStorage.removeItem('mne-compass-arrival');
      if(arriving&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        const animation=root.current?.animate([{opacity:0,filter:'blur(3px)'},{opacity:1,filter:'blur(0)'}],{duration:650,easing:'ease-out'});
        return()=>animation?.cancel();
      }
    }catch{}
  },[orderPage]);
  useEffect(()=>{
    const elements=Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add("is-visible");observer.unobserve(entry.target);}}),{threshold:.08});
    elements.forEach(el=>observer.observe(el));
    const sections=Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]"));
    const watch=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting)setChapter((entry.target as HTMLElement).dataset.chapter!);}),{rootMargin:"-30% 0px -45% 0px"});
    sections.forEach(el=>watch.observe(el));
    let frame=0;
    const update=()=>{
      const h=window.innerHeight,y=window.scrollY;
      const p=Math.min(1,Math.max(0,y/(h*1.2)));
      root.current?.style.setProperty("--scroll",String(p));
      root.current?.style.setProperty("--travel",y*.08+"px");
      document.querySelectorAll<HTMLElement>("[data-parallax]").forEach(el=>{
        const box=el.getBoundingClientRect();
        if(box.top<h*1.5&&box.bottom>-h)el.style.setProperty("--drift",((box.top-h/2)*.07)+"px");
      });
      frame=0;
    };
    const onScroll=()=>{if(!frame)frame=requestAnimationFrame(update);};
    update();window.addEventListener("scroll",onScroll,{passive:true});
    return()=>{observer.disconnect();watch.disconnect();window.removeEventListener("scroll",onScroll);cancelAnimationFrame(frame);};
  },[records.length]);
  useEffect(()=>()=>urls.current.forEach(url=>URL.revokeObjectURL(url)),[]);
  useEffect(()=>{const controller=new AbortController();fetch('/api/orders',{signal:controller.signal}).then(r=>r.json()).then(data=>setConnected(data.connected===true)).catch(()=>{});return()=>controller.abort();},[]);
  useEffect(()=>{
    if(detail!==null){dialog.current?.showModal();dialog.current?.scrollTo(0,0);}
    else dialog.current?.close();
  },[detail]);
  useEffect(()=>{setDraft(null);setReceipt(null);setSubmitError("");orderNumber.current="";},[photo,memory,family,customerName,contact]);
  function chooseImage(file?:File){
    if(!file)return;
    if(!["image/jpeg","image/png","image/webp","image/gif"].includes(file.type)){setError("Choose a JPG, PNG, WebP or GIF image.");return;}
    if(file.size>4*1024*1024){setError("Please choose an image smaller than 4 MB.");return;}
    const url=URL.createObjectURL(file);urls.current.push(url);setPhoto(url);setPhotoFile(file);setError("");setDraft(null);
  }
  function example(){setPhoto("/campaign-20261105-06.webp");setPhotoFile(null);setMemory("저녁 공기에 섞인 소금기. 바다 사진 곁에서 일렁이던 촛불, 집에서 멀리 떠나왔다는 고요한 기분.");setError("");setDraft(null);}
  function next(){if(!photo||!memory.trim()){setError("Bring a photograph and a few words before continuing.");return;}setError("");jump("scent");}
  function prepareOrder(){
    if(!photo){setError("Add a photograph.");jump("memory");return;}
    try{setDraft(makeOrderDraft({photoLink:"",description:memory,preferredNote:recipe.name,customerName,contact}));setError("");requestAnimationFrame(()=>jump("order-review"));}
    catch(cause){setError(cause instanceof Error?cause.message:"Check your order details.");jump("memory");}
  }
  async function submitOrder(){
    if(!draft||!connected||submitting||receipt)return;
    if(!photoFile){setSubmitError("Upload your own photograph. The sample image is for preview only.");return;}
    setSubmitting(true);setSubmitError("");
    orderNumber.current ||= 'MNE-'+crypto.randomUUID();
    const form=new FormData();
    form.set('orderNumber',orderNumber.current);form.set('description',draft['설명텍스트']);form.set('preferredNote',draft['선호노트']);form.set('customerName',draft['주문자']);form.set('contact',draft['연락처']);form.set('photoLink',draft['사진링크']);
    if(photoFile)form.set('photo',photoFile);
    try{const response=await fetch('/api/orders',{method:'POST',body:form});if(response.status===429)throw new Error('Please wait a minute before trying again.');const result=await response.json();if(!response.ok)throw new Error(result.error||'We could not confirm your order.');setReceipt(result);}
    catch(cause){setSubmitError(cause instanceof Error?cause.message:'We could not confirm your order. Please retry.');}
    finally{setSubmitting(false);}
  }
  return <main ref={root} className={"mne-experience chapter-"+chapter+(orderPage?" dedicated-order":"")}>
    <ArchitecturalBackground/>
    <div className="paper-grain" aria-hidden="true"/>
    <a className="skip-link" href="#memory">향 만들기로 건너뛰기</a>
    <header className="site-header">
      <a href={orderPage?"/":"#home"} className="fixed-brand" aria-label="MNÉ 홈"><span className="brand-logo"><img src="/mne-brand-logo.png" width="2481" height="3508" alt="MNÉ" draggable={false}/></span></a>
      <nav className="fixed-nav" aria-label="주요 메뉴">
        <a href={orderPage?"/#about":"#about"} aria-current={chapter==='about'?'location':undefined}><Pair en="The idea" ko="소개"/></a>
        <a href={orderPage?"/#archive":"#archive"} aria-current={chapter==='archive'?'location':undefined}><Pair en="Archive" ko="아카이브"/></a>
        <a className="nav-create" href="#memory" aria-current={['memory','scent','candle'].includes(chapter)?'location':undefined}><Pair en="Create" ko="향 만들기"/><Arrow/></a>
      </nav>
    </header>
    {!orderPage&&<><section id="home" data-chapter="home" className="hero-scroll">
      <section className="hero-stage">
        <div className="hero-editorial">
          <img className="hero-photograph" src="/campaign-20261105-07.webp" alt="바위 위에 놓인 은색 MNÉ 향초" fetchPriority="high"/>
          <div className="hero-story">
            <h1><Pair en={"A fragrance\nby memory."} ko={"기억으로\n태어난 향."}/></h1>
            <p><Pair en="A place fades. A feeling stays. Turn a moment you remember into a scent of your own." ko="장소는 흐려져도 감정은 남습니다. 간직한 한순간을 당신만의 향으로 만들어 보세요."/></p>
            <a className="editorial-link" href="#memory"><Pair en="Bring your memory" ko="기억 가져오기"/><Arrow/></a>
          </div>
        </div>
        <div className="hero-navigation">
          <div className="hero-compass-control"><InteractiveCompass value={bearing} labels={bearings.map(b=>b.titleKo)} onChange={setBearing} label="나침반으로 둘러보기"/></div>
          <div className="hero-wayfinding">
            <Pair className="dial-caption" en="Turn the compass. Follow the red point to begin." ko="나침반을 돌리고, 붉은 지점을 눌러 시작하세요."/>
            <button className="hero-destination" onClick={()=>jump(bearings[bearing].key)}><Pair en={bearings[bearing].title} ko={bearings[bearing].titleKo}/><Arrow/></button>
          </div>
        </div>
      </section>
    </section>

    <section id="about" data-chapter="about" className="intro-section section-pad">
      <div className="intro-copy" data-reveal><h2><Pair en="What you saw.\nHow it felt." ko="눈에 담은 장면.\n마음에 남은 감정."/></h2><p><Pair en="A photograph holds what you saw. A fragrance holds how it felt. MNÉ brings the two together, giving a fleeting moment a tangible form." ko="사진은 당신이 본 것을 담고, 향기는 그 순간의 감정을 간직합니다. MNÉ는 이 둘을 이어, 스쳐 간 기억에 손에 잡히는 형태를 만듭니다."/></p></div>
      <div className="process-overview">{[
        {en:'Bring a moment',ko:'기억 가져오기',body:'A photograph and a few words. Start with something only you remember.',translation:'사진 한 장과 짧은 글. 당신만 기억하는 순간에서 시작합니다.'},
        {en:'Find a direction',ko:'향의 방향 찾기',body:'Explore five scent families. Choose the feeling closest to your memory.',translation:'다섯 가지 향 계열 중 기억에 가장 가까운 감정을 찾아보세요.'},
        {en:'Make it tangible',ko:'향초로 간직하기',body:'Three scent strips, one choice. A candle that brings you back.',translation:'세 가지 시향지, 하나의 선택. 당신을 그때로 데려다줄 향초.'},
      ].map(step=><div key={step.en}><h3><Pair en={step.en} ko={step.ko}/></h3><p><Pair en={step.body} ko={step.translation}/></p></div>)}</div>
    </section>

    </>}
    <section id="memory" data-chapter="memory" className="memory-section section-pad" inert={submitting}>
      <div className="section-heading" data-reveal><h2><Pair en={"Go back.\nJust for a moment."} ko={"어떤 순간을\n간직하고 싶나요?"} className="heading-line"/></h2></div>
      <div className="memory-grid">
        <div className="memory-photo-column" data-reveal data-parallax>
          <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif" onChange={e=>chooseImage(e.target.files?.[0])}/>
          <button className={"photo-input "+(photo?"has-photo":"")}  onClick={()=>input.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();chooseImage(e.dataTransfer.files[0]);}}>
            <img src={photo||"/campaign-20261105-06.webp"} alt={photo?"내가 올린 기억의 사진":"밝은 바위 위에 놓인 MNÉ 향초"}/>
            <span className="photo-action"><Pair en={photo?"Change photograph":"Bring your photograph"} ko={photo?"사진 바꾸기":"사진 가져오기"}/><i>+</i></span>
          </button>
          <div className="photo-meta"><span>JPG · PNG · WebP · GIF / 최대 4MB</span></div>
        </div>
        <div className="memory-fields" data-reveal>
          <label htmlFor="memory-text"><Pair en="What did it feel like?" ko="어떤 기분이었나요?"/></label>
          <textarea id="memory-text" value={memory} placeholder="공기와 빛, 사진에 담기지 않은 것들을 들려주세요." onChange={e=>{setMemory(e.target.value);setDraft(null);}}/>
          <div className="field-meta"><button onClick={example} ><Pair en="Try a sample memory" ko="예시 기억 불러오기"/></button><span>{memory.length}</span></div>
          <div className="order-fields">
            <label htmlFor="customer-name"><Pair en="Your name" ko="이름"/></label><input id="customer-name" autoComplete="name" value={customerName} onChange={e=>setCustomerName(e.target.value)} placeholder="이름" aria-required="true"/>
            <label htmlFor="customer-contact"><Pair en="Email or phone" ko="이메일 또는 전화번호"/></label><input id="customer-contact" value={contact} onChange={e=>setContact(e.target.value)} placeholder="연락받을 이메일 또는 전화번호" aria-required="true"/>
          </div>
          {error&&<p role="alert" className="field-error"><Pair en={error} ko={errors[error]||"입력 내용을 확인한 뒤 다시 시도해 주세요."}/></p>}
          <button className="text-link" onClick={next}><Pair en="Find its direction" ko="향의 방향 찾기"/><i><Arrow/></i></button>
          <p className="fine-print"><Pair en={connected?"Nothing is sent until you submit your order.":"The connection is unavailable. Your details stay in this tab."} ko={connected?"주문 접수 전에는 정보가 전송되지 않습니다.":"현재 접수 연결을 사용할 수 없습니다. 입력한 정보는 이 탭에만 남아 있습니다."}/></p>
        </div>
      </div>
    </section>

    <section id="scent" data-chapter="scent" className={"scent-section family-"+family} style={{"--scent-tone":recipe.color} as CSSProperties} inert={submitting}>
      <div className="scent-top section-pad" data-reveal><h2><Pair en="Follow the feeling." ko="어떤 향에 가까운가요?"/></h2></div>
      <div className="scent-workspace section-pad">
      <div className="scent-compass-stage">
        <InteractiveCompass value={family} labels={notes.map(note=>note.ko)} onChange={setFamily} label="향 나침반" onPoint={prepareOrder}/>
        <p id="compass-instructions"><Pair en="Drag in a circle or choose a note" ko="나침반을 돌리거나 향 계열을 선택하세요."/></p>
      </div>
      <div className="compass-note-list" aria-label="선호 향 계열">{families.map((f,i)=><button key={f.name} aria-pressed={family===i} onClick={()=>setFamily(i)}><Pair en={f.name} ko={notes[i].ko}/><span className="note-indicator" aria-hidden="true"/></button>)}</div>
      <div className="scent-bottom">
        <div className="scent-description" key={family}><p><Pair en={recipe.description} ko={notes[family].translation}/></p></div>
        <div className="scent-action">
          <button className="text-link" onClick={prepareOrder}><Pair en="Review my order" ko="주문 확인하기"/><i><Arrow/></i></button>
          <p className="fine-print"><Pair en="Your preference guides MSE. It is not a finished recipe." ko="선호 향 계열은 분석의 방향을 정하는 정보이며, 완성된 향 배합은 아닙니다."/></p>
        </div>
      </div>
      </div>
    </section>

    <section id="candle" data-chapter="candle" className="candle-section section-pad">
      <div className="section-heading" data-reveal><h2><Pair en={"Find the one\nthat takes you back."} ko={"당신을 그때로\n데려다주는 향."} className="heading-line"/></h2></div>
      <div className="candle-grid">
        <div className="candle-visual" data-reveal><div className="product-photo"><img src="/campaign-20261105-03.webp" alt="마른 잎 아래 놓인 은색 MNÉ 향초" loading="lazy"/></div></div>
        <div className="candle-copy" data-reveal><h3><Pair en={"One scent.\nEntirely yours."} ko={"오롯이\n당신만의 향."}/></h3><p><Pair en="Explore three scent strips. Choose the one that feels like your memory. We turn it into a candle, made for you." ko="세 가지 시향지를 경험하고, 당신의 기억과 가장 가까운 향을 골라 주세요. 그 향을 당신만의 향초로 완성합니다."/></p><div className="product-spec"><span>90 g / 3.1 oz</span><span>국내 수작업 제작</span></div><button className="text-link" onClick={()=>jump('memory')}><Pair en="Create your candle" ko="나만의 향초 만들기"/><i><Arrow/></i></button></div>
      </div>
      {(orderPage||draft)&&<div id="order-review" className="order-review">
        <span className="draft-label"><Pair en={receipt?"Order recorded / awaiting analysis":draft?"Order draft / not submitted":"Your order / not yet prepared"} ko={receipt?"주문 접수됨 / 분석 대기":draft?"주문 초안 / 미접수":"주문 정보 / 입력 전"}/></span>
        <h3><Pair en={draft?"A moment, ready to review.":"A memory has more than one direction."} ko={draft?"주문 정보를 확인해 주세요.":"하나의 기억, 여러 향의 방향."}/></h3>
        <p><Pair en={receipt?"Your order is recorded. MSE fragrance analysis is not connected yet.":draft?"Review your details before submitting your order.":"Share your photograph, your words, and a preferred note. Three scent strips will help you choose a fragrance."} ko={receipt?"주문이 접수되었습니다. MSE 향 분석 기능은 아직 연결되지 않았습니다.":draft?"주문을 접수하기 전에 입력한 정보를 확인해 주세요.":"사진과 짧은 글, 선호하는 향 계열을 알려 주세요. 세 가지 시향지를 경험하고 향을 고르게 됩니다."}/></p>
        {draft&&<><dl className="order-summary"><div><dt><Pair en="Preferred note" ko="선호 향 계열"/></dt><dd><Pair en={recipe.name} ko={notes[family].ko}/></dd></div><div><dt><Pair en="Customer" ko="이름"/></dt><dd>{draft["주문자"]}</dd></div><div><dt><Pair en="Contact" ko="연락처"/></dt><dd>{draft["연락처"]}</dd></div><div><dt><Pair en="Photo" ko="사진"/></dt><dd><Pair en={receipt?"Saved privately in Drive":photoFile?"Ready to upload":"Sample preview only"} ko={receipt?"Drive에 비공개로 저장됨":photoFile?"업로드 준비됨":"미리보기용 예시 사진"}/></dd></div><div><dt><Pair en="Memory" ko="기억"/></dt><dd className="original-memory">{draft["설명텍스트"]}</dd></div></dl><p className="fine-print"><Pair en={receipt?"MNÉ manages processing and recipe IDs separately.":"This draft has not been submitted. A receipt is issued after confirmed submission."} ko={receipt?"진행 상태와 향 배합 번호는 MNÉ가 별도로 관리합니다.":"이 초안은 아직 접수되지 않았습니다. 접수가 확인되면 주문 번호가 발급됩니다."}/></p></>}
        {receipt&&<p role="status" className="order-receipt"><Pair en="Order recorded" ko="주문 접수됨"/><span>{receipt.orderNumber}</span><Pair en={"Received "+new Date(receipt.receivedAt).toLocaleString("en-GB",{timeZone:"Asia/Seoul"})+" (KST)"} ko={"접수 "+new Date(receipt.receivedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}/></p>}
        {draft&&!receipt&&<><button className="text-link" disabled={!connected||submitting} onClick={submitOrder}><Pair en={submitting?"Recording your order…":connected?"Submit to MNÉ":"Connection unavailable"} ko={submitting?"주문 접수 중…":connected?"MNÉ에 주문 접수하기":"현재 접수 연결 불가"}/> <i><Arrow/></i></button><p className="fine-print"><Pair en="Submitting sends your name, contact details, memory, preferred note and photo to MNÉ’s private order sheet and Drive. They are never added to the public archive." ko="접수하면 이름, 연락처, 기억, 선호 향 계열과 사진이 MNÉ의 비공개 주문 시트와 Drive에 저장됩니다. 아카이브에는 공개되지 않습니다."/></p></>}
        {submitError&&<p role="alert" className="field-error"><Pair en={submitError} ko={errors[submitError]||"접수하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요."}/></p>}
        <button className="text-link" disabled={submitting} onClick={()=>jump("memory")}><Pair en={draft?"Edit order details":"Bring a memory"} ko={draft?"주문 정보 수정하기":"기억 가져오기"}/> <i><Arrow/></i></button>
      </div>}
      <details className="process-details"><summary><Pair en="From your memory to your candle" ko="기억이 향초가 되는 과정"/><span aria-hidden="true">+</span></summary>
      <div className="journey-heading"><p><Pair en="Fragrance analysis is not connected yet." ko="현재 자동 향 분석 기능은 연결되지 않았습니다."/></p></div>
      <ol className="order-journey">{PROCESS_STEPS.map((step,i)=><li key={step.value}><span>0{i+1}</span><div><h4><Pair en={step.label} ko={step.value}/></h4><p><Pair en={step.description} ko={processKo[i]}/></p></div></li>)}</ol>
      </details>
    </section>

    <section id="archive" data-chapter="archive" className="archive-section">
      <div className="archive-heading section-pad" data-reveal><h2><Pair en="Memory archive" ko="기억의 아카이브" className="heading-line"/></h2><p><Pair en="Step inside a memory." ko="서로 다른 삶에 남은 익숙한 감정들."/></p></div>
      <div className="archive-grid">{records.map((record,i)=><button key={record.title+i} className={"memory-card card-"+i%5} data-reveal onClick={()=>setDetail(i)}>
        <div className="card-label"><Pair en={record.title} ko={memories[i].titleKo}/></div>
        <div className={"card-art art-"+record.family.toLowerCase()}>{record.image?<img src={record.image} alt={memories[i].titleKo} loading="lazy"/>:<span className="card-letter">{notes[memories[i].family].ko}</span>}<span className="card-view"><Pair en="ENTER MEMORY ↗" ko="기억 속으로 ↗"/></span><span className="card-family"><Pair en={record.family} ko={notes[memories[i].family].ko}/></span></div>
        <div className="card-meta"><Pair en={record.place} ko={memories[i].placeKo}/><Pair en={record.notes} ko={memories[i].notesKo}/></div>
      </button>)}</div>
      <p className="archive-caption section-pad"><Pair en="Illustrative scent stories. Private order details are never added to this archive." ko="향을 상상해 보는 예시 이야기입니다. 개인 주문 정보는 이 아카이브에 공개되지 않습니다."/></p>
    </section>

    <section data-chapter="return" className="closing-section section-pad"><button className="closing-link" onClick={()=>jump("memory")}><Pair en="Make a memory tangible." ko={"당신의 기억을\n향으로 남겨 보세요."} className="heading-line"/><i><Arrow/></i></button><div className="closing-meta"><a href={orderPage?"/":"#home"}><Pair en="BACK TO THE BEGINNING ↑" ko="처음으로 ↑"/></a></div></section>

    <dialog ref={dialog} className="memory-detail" aria-labelledby="detail-title" onCancel={()=>setDetail(null)} onClose={()=>setDetail(null)}>
      {selected&&<article style={{"--detail-color":selected.family==="Fresh"?"#cbdce0":selected.family==="Floral"?"#e4d8d4":selected.family==="Fruity"?"#decdb2":"#d5d6c8"} as CSSProperties}>
        <header><Pair en="Memory archive" ko="기억의 아카이브"/><button autoFocus onClick={()=>setDetail(null)}><Pair en="Close ×" ko="닫기 ×"/></button></header>
        <div className="detail-marquee"><h2 id="detail-title"><Pair en={selected.title} ko={memories[detail??0].titleKo}/></h2></div>
        <div className="detail-body"><div className="detail-info"><Pair className="eyebrow" en={selected.place+" / "+selected.family} ko={memories[detail??0].placeKo+" / "+notes[memories[detail??0].family].ko}/><p><Pair en={selected.memory} ko={memories[detail??0].ko}/></p><Pair className="detail-notes" en={selected.notes} ko={memories[detail??0].notesKo}/></div><div className="detail-image">{selected.image?<img src={selected.image} alt={memories[detail??0].titleKo}/>:<span>{notes[memories[detail??0].family].ko}</span>}</div></div>
        <button className="next-memory" onClick={()=>{setDetail(v=>((v??0)+1)%records.length);}}><Pair en="Next memory" ko="다음 기억"/><span><Arrow/></span></button>
      </article>}
    </dialog>
  </main>;
}
