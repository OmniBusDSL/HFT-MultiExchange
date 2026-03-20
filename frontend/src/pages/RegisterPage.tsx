import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/AuthPage.css';

type ReferralStatus = 'idle' | 'checking' | 'valid' | 'invalid';

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { register, isLoading, error } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    referred_by: ''
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [registrationSuccess, setRegistrationSuccess] = useState<{ email: string; referral_code: string } | null>(null);
  const [referralStatus, setReferralStatus] = useState<ReferralStatus>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced check: fires 600ms after user stops typing
  useEffect(() => {
    const code = formData.referred_by.trim().toUpperCase();

    if (code.length === 0) {
      setReferralStatus('idle');
      return;
    }

    if (code.length !== 9) {
      setReferralStatus('idle');
      return;
    }

    setReferralStatus('checking');

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/referral/check?code=${code}`);
        const data = await res.json();
        setReferralStatus(data.valid ? 'valid' : 'invalid');
      } catch {
        setReferralStatus('idle');
      }
    }, 600);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [formData.referred_by]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'referred_by' ? value.toUpperCase() : value
    }));
    setFormError(null);
  };

  const validateForm = (): boolean => {
    if (!formData.email) {
      setFormError('Email is required');
      return false;
    }

    if (!formData.email.includes('@')) {
      setFormError('Invalid email format');
      return false;
    }

    if (!formData.password) {
      setFormError('Password is required');
      return false;
    }

    if (formData.password.length < 8) {
      setFormError('Password must be at least 8 characters');
      return false;
    }

    if (formData.password !== formData.confirmPassword) {
      setFormError('Passwords do not match');
      return false;
    }

    // Referral code validation (if provided)
    if (formData.referred_by) {
      if (formData.referred_by.length !== 9) {
        setFormError('Referral code must be 9 characters');
        return false;
      }
      if (referralStatus === 'invalid') {
        setFormError('This referral code does not exist');
        return false;
      }
      if (referralStatus === 'checking') {
        setFormError('Please wait, checking referral code...');
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!validateForm()) {
      return;
    }

    try {
      console.log('[RegisterPage] Submitting registration...');
      console.log('[RegisterPage] Email:', formData.email);
      console.log('[RegisterPage] Referred by:', formData.referred_by || 'none');

      const result = await register(
        formData.email,
        formData.password,
        formData.referred_by || undefined
      );

      console.log('[RegisterPage] Registration successful!');
      console.log('[RegisterPage] Result:', result);
      console.log('[RegisterPage] Referral code:', result.referral_code);

      // Store the referral code for display
      setRegistrationSuccess({
        email: formData.email,
        referral_code: result.referral_code
      });
      // Navigate after a short delay to show success
      setTimeout(() => navigate('/dashboard'), 3000);
    } catch (err) {
      console.error('[RegisterPage] Registration error:', err);
      // Error is already set in context
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-card">
          <h1 className="auth-title">⚡ Create Account</h1>
          <p className="auth-subtitle">Join the Real BTC Exchange</p>

          {(formError || error) && (
            <div className="alert alert-error">
              {formError || error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                disabled={isLoading}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="At least 8 characters"
                disabled={isLoading}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="Confirm your password"
                disabled={isLoading}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="referred_by">Referral Code (Optional)</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="referred_by"
                  type="text"
                  name="referred_by"
                  value={formData.referred_by}
                  onChange={handleChange}
                  placeholder="Enter 9-character referral code"
                  disabled={isLoading}
                  maxLength={9}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    paddingRight: '40px',
                    borderColor:
                      referralStatus === 'valid' ? '#4ade80' :
                      referralStatus === 'invalid' ? '#f87171' : undefined,
                    outline: referralStatus === 'valid' ? '1px solid #4ade80' :
                             referralStatus === 'invalid' ? '1px solid #f87171' : undefined,
                  }}
                />
                {referralStatus === 'checking' && (
                  <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px' }}>⏳</span>
                )}
                {referralStatus === 'valid' && (
                  <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px' }}>✅</span>
                )}
                {referralStatus === 'invalid' && (
                  <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px' }}>❌</span>
                )}
              </div>
              {referralStatus === 'valid' && (
                <small style={{ color: '#4ade80' }}>✓ Valid referral code</small>
              )}
              {referralStatus === 'invalid' && (
                <small style={{ color: '#f87171' }}>✗ This referral code does not exist</small>
              )}
              {referralStatus === 'idle' && (
                <small>If someone invited you, enter their 9-character referral code</small>
              )}
              {referralStatus === 'checking' && (
                <small style={{ color: '#aaa' }}>Checking code...</small>
              )}
            </div>

            <button
              type="submit"
              className="btn-submit"
              disabled={isLoading || registrationSuccess !== null}
            >
              {isLoading ? 'Creating Account...' : 'Create Account'}
            </button>

            {registrationSuccess && (
              <div className="alert alert-success">
                <h3>✅ Account Created Successfully!</h3>
                <p>Your Referral Code: <strong>{registrationSuccess.referral_code}</strong></p>
                <p style={{ fontSize: '0.9em', marginTop: '10px' }}>
                  Share this code with others to earn rewards. Redirecting to dashboard...
                </p>
              </div>
            )}
          </form>

          <p className="auth-footer">
            Already have an account?{' '}
            <a href="/login" onClick={() => navigate('/login')}>
              Sign In
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};
