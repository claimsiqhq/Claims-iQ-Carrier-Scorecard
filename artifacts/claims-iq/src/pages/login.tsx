import { useState, useCallback } from "react";
import { BRAND, FONTS } from "@/lib/brand";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Lock, Mail } from "iconoir-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    setError(null);
    const err = await login(email, password);
    if (err) {
      setError(err);
      setLoading(false);
    }
  }, [email, password, login]);

  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center p-4"
      style={{ backgroundColor: BRAND.offWhite }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}images/claims-iq-logo.png`}
            alt="ClaimsiQ"
            className="h-14 w-14 mx-auto mb-4"
          />
          <h1
            className="text-2xl font-bold mb-1"
            style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}
          >
            Claims<span style={{ color: BRAND.purple }}>iQ</span>
          </h1>
          <p style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }} className="text-sm">
            Sign in to your account
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl p-6 space-y-5 border shadow-sm"
          style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}
        >
          <div>
            <label
              className="text-xs font-bold uppercase tracking-wider mb-1.5 block"
              style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}
            >
              Email
            </label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: BRAND.purpleSecondary }}>
                <Mail width={18} height={18} />
              </div>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full rounded-lg border pl-10 pr-3 py-2.5 text-sm outline-none transition-colors"
                style={{
                  borderColor: BRAND.greyLavender,
                  color: BRAND.deepPurple,
                  fontFamily: FONTS.body,
                }}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={(e) => (e.target.style.borderColor = BRAND.purple)}
                onBlur={(e) => (e.target.style.borderColor = BRAND.greyLavender)}
                autoFocus
              />
            </div>
          </div>

          <div>
            <label
              className="text-xs font-bold uppercase tracking-wider mb-1.5 block"
              style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}
            >
              Password
            </label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: BRAND.purpleSecondary }}>
                <Lock width={18} height={18} />
              </div>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-lg border pl-10 pr-3 py-2.5 text-sm outline-none transition-colors"
                style={{
                  borderColor: BRAND.greyLavender,
                  color: BRAND.deepPurple,
                  fontFamily: FONTS.body,
                }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={(e) => (e.target.style.borderColor = BRAND.purple)}
                onBlur={(e) => (e.target.style.borderColor = BRAND.greyLavender)}
              />
            </div>
          </div>

          {error && (
            <p
              className="text-xs px-3 py-2 rounded-lg text-center"
              style={{ backgroundColor: "#fef2f2", color: "#dc2626" }}
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full text-white font-semibold py-2.5"
            style={{
              backgroundColor: loading ? BRAND.purpleSecondary : BRAND.purple,
              fontFamily: FONTS.heading,
              fontWeight: 600,
            }}
            disabled={loading || !email || !password}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Signing in...
              </span>
            ) : (
              "Sign In"
            )}
          </Button>
        </form>

        <p
          className="text-xs text-center mt-6"
          style={{ color: BRAND.purpleSecondary }}
        >
          Claims iQ Audit Engine
        </p>
      </div>
    </div>
  );
}
