import React from 'react';
import { LoginPage } from './LoginPage';

interface RegisterPageProps {
  onLoginSuccess?: () => void;
}

// Registration in GhostPost uses Telegram Auth (API ID + Hash + Phone) directly
export const RegisterPage: React.FC<RegisterPageProps> = ({ onLoginSuccess }) => {
  return <LoginPage onLoginSuccess={onLoginSuccess} />;
};
