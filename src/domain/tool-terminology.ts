import type { Observations } from './contracts.ts';

type Observation=Observations['objects'][number];
export interface ToolProfile {
  kind:string|null;
  uncertain:boolean;
  power:string|null;
  brand:string|null;
  model:string|null;
  mount:string|null;
}

/** Visible terminology only. Never infer manufacturer, mechanism or identity from colour. */
export function toolProfile(object:Observation):ToolProfile {
  const raw=`${object.label} ${object.appearance}`.toLowerCase();
  const text=raw.replace(/[-–]/g,' ');
  const field=object.uncertainty.toLowerCase();
  const uncertain=/\b(?:maybe|possibly|unclear|uncertain|unknown|not visible)\b/.test(field)&&/\b(?:kind|type|drill|driver|mechanism)\b/.test(field)
    || /\b(?:not|without|possibly|maybe)\s+(?:an?\s+)?(?:impact driver|drill|screwdriver)\b/.test(text);
  const impact=/\bimpact\s+(?:drill\s+)?drivers?\b/.test(text);
  const wrench=/\b(?:impact\s+)?wrench(?:es)?\b/.test(text);
  const hammer=/\b(?:hammer|impact|rotary hammer)\s+drills?\b/.test(text);
  const screwdriver=/\bscrew\s*drivers?\b/.test(text);
  const drill=/\bdrills?\b/.test(text);
  const powered=/\b(?:cordless|battery(?: powered| operated)?)\b/.test(text);
  const driver=/\bdrivers?\b/.test(text)&&powered;
  // Explicit mechanisms remain distinct even though a model may call each a driver.
  const specific=[impact?'impact-driver':null,wrench?'wrench':null,hammer?'hammer-drill':null,screwdriver?'screwdriver':null].filter(Boolean);
  const conflict=specific.length>1||screwdriver&&drill||wrench&&drill;
  const kind=conflict?null:specific[0]??(drill||driver?'drill-driver':null);
  const brands=[...new Set(text.match(/\b(?:bosch|makita|dewalt|milwaukee|ryobi|metabo|hilti|einhell)\b/g)??[])];
  const models=[...new Set([...raw.matchAll(/\bmodel\s+([a-z0-9]+(?:[-_/][a-z0-9]+)*)/g)]
    .map(m=>m[1]).filter(value=>/\d/.test(value)).map(value=>value.replace(/[-_/]/g,'')))];
  const corded=/\bcorded\b/.test(text);
  const hex=/\bhex\s+(?:collet|holder|chuck)\b/.test(text),jaw=/\b(?:three jaw|3 jaw)\s+chuck\b/.test(text);
  return {kind,uncertain:uncertain||conflict||brands.length>1||models.length>1||corded&&powered||hex&&jaw,
    power:corded&&!powered?'corded':powered&&!corded?'cordless':null,
    brand:brands.length===1?brands[0]:null,model:models.length===1?models[0]:null,
    mount:hex&&!jaw?'hex':jaw&&!hex?'three-jaw':null};
}

export function toolConflict(left:ToolProfile,right:ToolProfile){
  return (['power','brand','model','mount'] as const).some(key=>left[key]&&right[key]&&left[key]!==right[key]);
}
