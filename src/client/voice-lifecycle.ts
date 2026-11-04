/** Owns the current recording request across cancellation and object unmount. */
export class VoiceLifecycle {
 private version=0;
 private stream: MediaStream | null=null;
 begin(){return ++this.version;}
 isCurrent(token:number){return token===this.version;}
 acceptStream(token:number,stream:MediaStream){if(!this.isCurrent(token)){stream.getTracks().forEach(track=>track.stop());return false;}this.stream=stream;return true;}
 release(token?:number){if(token!==undefined&&!this.isCurrent(token))return false;this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;return true;}
 cancel(){this.version++;this.release();}
}
