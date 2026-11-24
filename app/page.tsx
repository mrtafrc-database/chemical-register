
"use client";

import { useState } from "react";

import {AUTH_API_URL as API_URL, BASE_PATH} from "../lib/config";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Login failed");
      }

      sessionStorage.setItem(
        "chemical_register_token",
        result.token
      );

      window.location.href = `${BASE_PATH}/dashboard/`;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to connect"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#f3f7f7",
      padding: "24px",
      fontFamily: "Arial, sans-serif"
    }}>
      <section style={{
        width: "100%",
        maxWidth: "420px",
        background: "#ffffff",
        borderRadius: "16px",
        padding: "36px",
        boxShadow: "0 8px 30px rgba(0,0,0,0.07)"
      }}>
        <div style={{
          width: "48px",
          height: "48px",
          borderRadius: "12px",
          background: "#00a99d",
          color: "white",
          display: "grid",
          placeItems: "center",
          fontSize: "24px",
          fontWeight: "bold",
          marginBottom: "24px"
        }}>
          C
        </div>

        <h1 style={{
          fontSize: "25px",
          color: "#263746",
          margin: "0 0 8px"
        }}>
          Chemical Register
        </h1>

        <p style={{
          color: "#718096",
          fontSize: "14px",
          marginBottom: "28px"
        }}>
          Chemical Request Management System
        </p>

        <form onSubmit={handleLogin}>
          <label style={{
            display: "block",
            fontSize: "14px",
            fontWeight: 600,
            marginBottom: "8px",
            color: "#344054"
          }}>
            Username
          </label>

          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
            required
            style={inputStyle}
          />

          <label style={{
            display: "block",
            fontSize: "14px",
            fontWeight: 600,
            margin: "18px 0 8px",
            color: "#344054"
          }}>
            Password
          </label>

          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            style={inputStyle}
          />

          {error && (
            <p style={{
              color: "#dc2626",
              fontSize: "13px",
              marginTop: "16px"
            }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              marginTop: "24px",
              padding: "13px",
              border: "none",
              borderRadius: "8px",
              background: loading ? "#8abdb8" : "#00a99d",
              color: "white",
              fontSize: "15px",
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer"
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p style={{
          textAlign: "center",
          color: "#98a2b3",
          fontSize: "12px",
          marginTop: "28px"
        }}>
          Authorized personnel only
        </p>
      </section>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px",
  border: "1px solid #d0d5dd",
  borderRadius: "8px",
  fontSize: "15px",
  outlineColor: "#00a99d"
};
