import {lazy,Suspense} from 'react';
import { createRoot } from 'react-dom/client';

const scanReview=window.location.pathname.replace(/\/$/,'')==='/scan-review';
const mobile=window.location.pathname.replace(/\/$/,'')==='/mobile';
const Screen=mobile?lazy(()=>import('./MobileWorkspace.tsx').then(module=>({default:module.MobileWorkspace}))):scanReview?lazy(()=>import('./ScanReview.tsx').then(module=>({default:module.ScanReview}))):lazy(async()=>{await import('./styles.css');const module=await import('./App.tsx');return {default:module.App};});
createRoot(document.getElementById('root')!).render(<Suspense fallback={<p style={{padding:32,fontFamily:'sans-serif'}}>Loading…</p>}><Screen/></Suspense>);
