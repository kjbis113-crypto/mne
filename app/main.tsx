import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Home from './page';
import { PaymentReturn } from './commerce-flow';
import { AdminPage, LegalPage, OrderLookup } from './commerce-pages';
import './editorial.css';
import './commerce.css';
import './commerce-pages.css';

const path = window.location.pathname.replace(/\/$/, '') || '/';
const page = path === '/admin' ? <AdminPage/> : path === '/orders' ? <OrderLookup/>
  : path === '/terms' ? <LegalPage kind="terms"/>
  : path === '/privacy' ? <LegalPage kind="privacy"/>
  : path === '/refund' ? <LegalPage kind="refund"/>
  : path.startsWith('/payment/') ? <PaymentReturn/>
  : <Home orderPage={path === '/order'}/>;
createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>);
