import React from 'react';
import Dashboard from '@/components/Dashboard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function App() {
  return (
    <div className="dark">
      <ErrorBoundary>
        <TooltipProvider>
          <Dashboard />
        </TooltipProvider>
      </ErrorBoundary>
    </div>
  );
}
