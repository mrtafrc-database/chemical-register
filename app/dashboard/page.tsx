
"use client";

import { useEffect, useState } from "react";

const API_URL = "https://chemical-register-api.mrtafrc.workers.dev";

type User = {
  username: string;
  displayName: string;
  sectionId: string | null;
  roles: string[];
};

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkSession() {
      const token = sessionStorage.getItem(
        "chemical_register_token"
      );

      if (!token) {
        window.location.href = "../";
        return;
      }

      try {
        const response = await fetch(`${API_URL}/me`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          sessionStorage.removeItem("chemical_register_token");
          window.location.href = "../";
          return;
        }

        setUser(result.user);
      } catch {
        alert("Unable to connect to the server.");
      } finally {
        setLoading(false);
      }
    }

    checkSession();
  }, []);

  async function handleLogout() {
    const token = sessionStorage.getItem(
      "chemical_register_token"
    );

    try {
      if (token) {
        await fetch(`${API_URL}/logout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
      }
    } finally {
      sessionStorage.removeItem("chemical_register_token");
      window.location.href = "../";
    }
  }

  if (loading) {
    return <main style={pageStyle}>Checking session...</main>;
  }

  if (!user) {
    return <main style={pageStyle}>Unable to load user information.</main>;
  }

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <strong>Chemical Register</strong>
        <button onClick={handleLogout} style={logoutStyle}>
          Sign Out
        </button>
      </header>

      <section style={{ padding: "32px" }}>
        <h1 style={{ color: "#263746" }}>
          Dashboard
        </h1>

        <p>Welcome, {user.displayName}</p>

        <div style={cardStyle}>
          <p><strong>Username:</strong> {user.username}</p>
          <p><strong>Section:</strong> {user.sectionId || "Not assigned"}</p>
          <p><strong>Role:</strong> {user.roles.join(", ")}</p>
        </div>

        {user.roles.includes("ADMIN") && (
          <p style={{ color: "#008f83" }}>
            Administrator access
          </p>
        )}
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f3f7f7",
  fontFamily: "Arial, sans-serif",
  color: "#344054"
};

const headerStyle: React.CSSProperties = {
  background: "#ffffff",
  padding: "18px 28px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderBottom: "1px solid #e5e7eb"
};

const logoutStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #d0d5dd",
  borderRadius: "6px",
  padding: "9px 16px",
  cursor: "pointer"
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: "12px",
  padding: "20px",
  maxWidth: "500px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
};
