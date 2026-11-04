/** Lossless wire encoding only: IDs outside viewId fields remain byte-for-byte exact. */
export type ViewAliasMetadata = {
 viewIdAliases?: Record<string,string>;
 viewIdAliasEncoding?: string;
};
function mapViewIds(value:unknown,replace:(id:string)=>string):unknown{
 if(Array.isArray(value))return value.map(item=>mapViewIds(item,replace));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='viewId'&&typeof item==='string'?replace(item):mapViewIds(item,replace)]));
 return value;
}
/** Keep ordinary packets untouched; intern repeated view references only on overflow. */
export function compactRoomPacketViewIds<T extends object>(packet:T,limit=18000):T&ViewAliasMetadata{
 if(JSON.stringify(packet).length<=limit)return packet;
 if('viewIdAliases' in packet||'viewIdAliasEncoding' in packet)throw new Error('View alias metadata is reserved.');
 const counts=new Map<string,number>();
 mapViewIds(packet,id=>{counts.set(id,(counts.get(id)??0)+1);return id;});
 const replacements=new Map<string,string>(),aliases:Record<string,string>={};let index=0;
 for(const [id,count] of counts){
  if(count<2)continue;
  let alias:string;do{alias=`@v${index++}`;}while(counts.has(alias));
  // Include dictionary overhead when assessing whether this reference saves space.
  if(count*(JSON.stringify(id).length-JSON.stringify(alias).length)<=JSON.stringify({[alias]:id}).length)continue;
  replacements.set(id,alias);aliases[alias]=id;
 }
 if(!replacements.size)return packet;
 const encoded={...mapViewIds(packet,id=>replacements.get(id)??id) as T,
  viewIdAliases:aliases,
  viewIdAliasEncoding:'Only viewId fields in this memory packet use these lossless aliases. Map each alias to its exact viewId here; external historical reference metadata retains exact viewIds.'};
 return JSON.stringify(encoded).length<JSON.stringify(packet).length?encoded:packet;
}
/** Evaluator/test utility: restore the exact original JSON packet without losing evidence. */
export function expandRoomPacketViewIds<T extends object>(packet:T&ViewAliasMetadata):T{
 const {viewIdAliases,viewIdAliasEncoding,...data}=packet;
 if(!viewIdAliases)return packet;
 return mapViewIds(data,id=>Object.hasOwn(viewIdAliases,id)?viewIdAliases[id]:id) as T;
}
