/** Invalidates in-flight answers whenever the draft changes, is cancelled or unmounts. */
export class AskMemoryLifecycle {
 private generation=0;
 private controller:AbortController|null=null;
 invalidate(){this.generation++;this.controller?.abort();this.controller=null;}
 begin(){this.invalidate();const generation=this.generation,controller=new AbortController();this.controller=controller;return {signal:controller.signal,isCurrent:()=>this.generation===generation&&!controller.signal.aborted};}
}
