// Source: Mne_주문접수_시트.xlsx, 주문접수!A1:J1 and 안내!A1:B32.
// This is the intake contract, not the separate MSE fragrance algorithm.
export const NOTE_VALUES = ["Fruity", "Floral", "Fresh", "Woody", "Balsamic"] as const;
export type PreferredNote = typeof NOTE_VALUES[number];
export const ORDER_COLUMNS = ["접수시각", "주문번호", "사진링크", "설명텍스트", "선호노트", "주문자", "연락처", "처리상태", "고유번호_A", "비고"] as const;
export const PROCESS_STEPS = [
  {value:"접수",label:"Received",description:"The order has been recorded."},
  {value:"분석완료",label:"Three scents",description:"MSE returns three candidates and assigns recipe IDs."},
  {value:"제작중",label:"Samples in the making",description:"Three scent strips are prepared."},
  {value:"시향지발송",label:"Samples sent",description:"Explore the three fragrances on scent strips."},
  {value:"선택완료",label:"Your selection",description:"Choose one fragrance. Its number is recorded in the order notes."},
  {value:"본품발송",label:"Candle sent",description:"Your selected fragrance becomes the finished candle."},
  {value:"완료",label:"Complete",description:"A memory, made tangible."},
] as const;
export type OrderDraft = Record<typeof ORDER_COLUMNS[number],string>;
export type MemoryInput = {photoLink:string;description:string;preferredNote:string;customerName:string;contact:string};
export function makeOrderDraft(input:MemoryInput):OrderDraft {
  if(!NOTE_VALUES.includes(input.preferredNote as PreferredNote))throw new Error("Choose Fruity, Floral, Fresh, Woody or Balsamic.");
  if(!input.description.trim())throw new Error("Add a few words about your memory.");
  if(!input.customerName.trim()||!input.contact.trim())throw new Error("Add your name and a contact detail to prepare your order.");
  if(input.photoLink){
    let url:URL;
    try{url=new URL(input.photoLink);}catch{throw new Error("Enter a valid HTTPS photo link, or leave it blank for now.");}
    if(url.protocol!=="https:")throw new Error("The photo link must use HTTPS.");
  }
  // Receipt metadata is populated only after a real, successful append.
  // Operator-owned fields remain empty. In particular, never synthesize MSE IDs.
  return {"접수시각":"","주문번호":"","사진링크":input.photoLink,"설명텍스트":input.description,"선호노트":input.preferredNote,"주문자":input.customerName,"연락처":input.contact,"처리상태":"","고유번호_A":"","비고":""};
}
