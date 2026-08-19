import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { Layout } from './components/Layout';

import { OverviewPage } from './pages/dashboard/OverviewPage';
import { ParserPage } from './pages/dashboard/ParserPage';
import { StorePage } from './pages/dashboard/StorePage';
import { PromptPage } from './pages/dashboard/PromptPage';
import { ArticlesPage } from './pages/dashboard/ArticlesPage';

import { ConfigPage } from './pages/ConfigPage';
import { EditorPage } from './pages/EditorPage';
import { AppConfig, SourceType, SystemStats } from './types';
import { processSinglePost } from './services/postProcessor';

const INITIAL_CONFIG: AppConfig = {
  sourceType: SourceType.TELEGRAM,
  sourceUrl: '@breakingnews_ru',
  destinationChannel: '@my_channel',
  telegramBotToken: '',
  useAI: true,
  removeLinks: true,
  checkInterval: 60,
  isSimulationMode: false,
  pricing: {
    wholesalePercent: 10,
    dropPercent: 30,
    retailPercent: 50,
    currencySymbol: '₽'
  },
  telegramAuth: {
    apiId: '',
    apiHash: '',
    phoneNumber: '',
    verificationCode: '',
    step: 'IDLE',
    isLoading: false,
    error: null
  }
};

function App() {
  const [config, setConfig] = useState<AppConfig>(INITIAL_CONFIG);
  const [stats, setStats] = useState<SystemStats>({
    totalProcessed: 12,
    lastRun: new Date().toISOString(),
    errors: 0,
    isServiceRunning: false
  });

  // Check auth status on load with localStorage persistence
  useEffect(() => {
    const cachedAuth = localStorage.getItem('ghostpost_auth') === 'true';
    if (cachedAuth) {
      setConfig(prev => ({
        ...prev,
        telegramAuth: { ...prev.telegramAuth, step: 'AUTHENTICATED' }
      }));
    }

    fetch('/status', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'authenticated' || data.authorized || data.telegram_authorized) {
          localStorage.setItem('ghostpost_auth', 'true');
          setConfig(prev => ({
            ...prev,
            telegramAuth: { ...prev.telegramAuth, step: 'AUTHENTICATED' }
          }));
        } else if (data.status === 'unauthorized') {
          localStorage.removeItem('ghostpost_auth');
          setConfig(prev => ({
            ...prev,
            telegramAuth: { ...prev.telegramAuth, step: 'IDLE' }
          }));
        }
      })
      .catch(() => {});
  }, []);

  const setAuthenticatedState = () => {
    localStorage.setItem('ghostpost_auth', 'true');
    setConfig(prev => ({ ...prev, telegramAuth: { ...prev.telegramAuth, step: 'AUTHENTICATED' } }));
  };

  const isUserAuthenticated = config.telegramAuth.step === 'AUTHENTICATED';

  const toggleService = () => {
    setStats(s => ({ ...s, isServiceRunning: !s.isServiceRunning }));
  };

  return (
    <BrowserRouter>
      <Routes>
        {/* Landing Page */}
        <Route path="/" element={<LandingPage />} />

        {/* Auth Pages */}
        <Route path="/login" element={<LoginPage onLoginSuccess={setAuthenticatedState} />} />
        <Route path="/register" element={<RegisterPage onLoginSuccess={setAuthenticatedState} />} />

        {/* Protected Dashboard Routes */}
        <Route
          path="/dashboard"
          element={
            <Layout isUserAuthenticated={isUserAuthenticated} config={config}>
              <OverviewPage config={config} stats={stats} onToggleService={toggleService} />
            </Layout>
          }
        />

        <Route
          path="/dashboard/parser"
          element={
            <Layout isUserAuthenticated={isUserAuthenticated} config={config}>
              <ParserPage config={config} setConfig={setConfig} />
            </Layout>
          }
        />

        <Route
          path="/dashboard/store"
          element={
            <Layout isUserAuthenticated={isUserAuthenticated} config={config}>
              <StorePage config={config} setConfig={setConfig} />
            </Layout>
          }
        />

        <Route
          path="/dashboard/prompt"
          element={
            <Layout isUserAuthenticated={isUserAuthenticated} config={config}>
              <PromptPage config={config} setConfig={setConfig} />
            </Layout>
          }
        />

        <Route
          path="/dashboard/orders"
          element={
            <Layout isUserAuthenticated={isUserAuthenticated} config={config}>
              <ArticlesPage />
            </Layout>
          }
        />

        <Route
          path="/dashboard/editor"
          element={
            <Layout isUserAuthenticated={isUserAuthenticated}>
              <EditorPage config={config} />
            </Layout>
          }
        />

        <Route
          path="/dashboard/settings"
          element={
            <Layout isUserAuthenticated={isUserAuthenticated}>
              <ConfigPage config={config} setConfig={setConfig} />
            </Layout>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;