import { registerRootComponent } from 'expo';
import React from 'react';
import App from './App';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';

function Root() {
  return React.createElement(AppErrorBoundary, null, React.createElement(App));
}

registerRootComponent(Root);
