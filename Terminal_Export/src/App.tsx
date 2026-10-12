import AuthGate from "@/components/AuthGate";
import KeepPanel from "@/components/KeepPanel";
import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
const Index = lazy(() => import('./pages/Index'));
const Admin = lazy(() => import('./pages/Admin'));
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

function TerminalRoutes() {
  const {pathname}=useLocation();
  return <>
    <KeepPanel active={pathname==='/' }><Index /></KeepPanel>
    <Routes>
      <Route path="/" element={null} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthGate><Suspense fallback={<p className="p-8 text-sm">Cargando terminal…</p>}><TerminalRoutes /></Suspense></AuthGate>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
