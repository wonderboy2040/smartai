import React from 'react';
import Dashboard from '@/components/Dashboard';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function App() {
  return (
    <div className="dark">
      <ErrorBoundary>
        <Dashboard />
      </ErrorBoundary>
    </div>
  );
}
