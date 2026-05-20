"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const GRID_SIZE = 50;

  const [username, setUsername] = useState("Loading...");
  const [newUsername, setNewUsername] = useState("");
  const [userId, setUserId] = useState("");
  const [credits, setCredits] = useState(0);

  const [squares, setSquares] = useState(
    Array(GRID_SIZE * GRID_SIZE).fill({
      color: "#ffffff",
      username: "",
    })
  );

  const [selectedColor, setSelectedColor] = useState("#ff0000");
  const [hoveredSquare, setHoveredSquare] = useState(null);
  const [tool, setTool] = useState("brush");
  const [isDrawing, setIsDrawing] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const panStart = useRef({ x: 0, y: 0 });
  const hasLoaded = useRef(false);

  useEffect(() => {
    async function setupUser() {
      let savedUsername = localStorage.getItem("username");
      let savedUserId = localStorage.getItem("userId");

      if (!savedUserId) {
        savedUserId = crypto.randomUUID();
        localStorage.setItem("userId", savedUserId);
      }

      if (!savedUsername) {
        savedUsername = "Guest" + Math.floor(1000 + Math.random() * 9000);
        localStorage.setItem("username", savedUsername);
      }

      setUserId(savedUserId);
      setUsername(savedUsername);
      setNewUsername(savedUsername);

      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("id", savedUserId)
        .maybeSingle();

      if (!data) {
        await supabase.from("users").insert({
          id: savedUserId,
          username: savedUsername,
          credits: 0,
        });

        setCredits(0);
      } else {
        setUsername(data.username);
        setNewUsername(data.username);
        localStorage.setItem("username", data.username);
        setCredits(data.credits || 0);
      }
    }

    setupUser();
  }, []);

  useEffect(() => {
    async function handlePaypalReturn() {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token");
      const paypalStatus = params.get("paypal");
      const paypalUserId = params.get("userId");

      if (paypalStatus === "cancel") {
        window.history.replaceState({}, "", "/");
        alert("Payment cancelled.");
        return;
      }

      if (!token || paypalStatus !== "success") return;

      const res = await fetch("/.netlify/functions/capture-paypal-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId: token,
          userId: paypalUserId,
        }),
      });

      const data = await res.json();

      if (res.ok && data.credits !== undefined) {
        setCredits(data.credits);
        alert("Payment successful! 100 credits added.");
      } else {
        alert("Payment succeeded, but credits could not be added. Please contact support.");
      }

      window.history.replaceState({}, "", "/");
    }

    handlePaypalReturn();
  }, []);

  const saveUsername = async () => {
    const cleaned = newUsername.trim();

    if (!cleaned) {
      alert("Username cannot be empty.");
      return;
    }

    if (cleaned.length > 20) {
      alert("Username must be 20 characters or less.");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(cleaned)) {
      alert("Use only letters, numbers, and underscores.");
      return;
    }

    if (cleaned === username) {
      alert("Username unchanged.");
      return;
    }

    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .eq("username", cleaned)
      .maybeSingle();

    if (existingUser) {
      alert("Username already taken.");
      return;
    }

    const { error: userError } = await supabase
      .from("users")
      .update({ username: cleaned })
      .eq("id", userId);

    if (userError) {
      alert("Could not update username.");
      return;
    }

    const { error: squareError } = await supabase
      .from("squares")
      .update({ username: cleaned })
      .eq("username", username);

    if (squareError) {
      alert("Username saved, but owned pixels could not update.");
      return;
    }

    localStorage.setItem("username", cleaned);
    setUsername(cleaned);
    setNewUsername(cleaned);

    await loadCanvas();

    alert("Username updated.");
  };

  const loadCredits = async () => {
    if (!userId) return;

    const { data } = await supabase
      .from("users")
      .select("credits")
      .eq("id", userId)
      .maybeSingle();

    if (data) setCredits(data.credits || 0);
  };

  const updateCredits = async (newCreditsValue) => {
    setCredits(newCreditsValue);

    await supabase
      .from("users")
      .update({ credits: newCreditsValue })
      .eq("id", userId);
  };

  const loadCanvas = async () => {
    const { data, error } = await supabase.from("squares").select("*");

    if (error) return;

    const grid = Array(GRID_SIZE * GRID_SIZE).fill({
      color: "#ffffff",
      username: "",
    });

    data.forEach((item) => {
      const index = (item.y - 1) * GRID_SIZE + (item.x - 1);

      if (index >= 0 && index < grid.length) {
        grid[index] = {
          color: item.color,
          username: item.username || "",
        };
      }
    });

    setSquares(grid);
  };

  useEffect(() => {
    loadCanvas();
  }, []);

  useEffect(() => {
    let channel;

    const initRealtime = async () => {
      if (hasLoaded.current) return;
      hasLoaded.current = true;

      await loadCanvas();

      channel = supabase
        .channel("squares-live")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "squares",
          },
          (payload) => {
            const row = payload.new;
            if (!row) return;

            const index = (row.y - 1) * GRID_SIZE + (row.x - 1);

            setSquares((prev) => {
              const updated = [...prev];
              updated[index] = {
                color: row.color,
                username: row.username || "",
              };
              return updated;
            });
          }
        )
        .subscribe();
    };

    initRealtime();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const buyCredits = async () => {
    if (!userId) {
      alert("User is still loading. Try again.");
      return;
    }

    const res = await fetch("/.netlify/functions/create-paypal-order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId }),
    });

    const data = await res.json();

    if (!data.url) {
      alert("Could not start PayPal checkout. Please try again.");
      return;
    }

    window.location.href = data.url;
  };

  const paintPixel = async (x, y, i) => {
    if (username === "Loading...") return;

    const pixel = squares[i];

    if (tool === "brush") {
      if (pixel.color !== "#ffffff" && pixel.username !== username) return;

      const isNewClaim = pixel.color === "#ffffff";

      if (isNewClaim && credits <= 0) return;

      if (pixel.color === selectedColor && pixel.username === username) return;

      const updated = [...squares];
      updated[i] = {
        color: selectedColor,
        username,
      };

      setSquares(updated);

      if (isNewClaim) {
        await updateCredits(Math.max(credits - 1, 0));
      }

      await supabase.from("squares").upsert(
        {
          x,
          y,
          color: selectedColor,
          username,
        },
        { onConflict: "x,y" }
      );
    }

    if (tool === "eraser") {
      if (pixel.username !== username) return;
      if (pixel.color === "#ffffff") return;

      const updated = [...squares];
      updated[i] = {
        color: "#ffffff",
        username: "",
      };

      setSquares(updated);

      await updateCredits(credits + 1);

      await supabase.from("squares").upsert(
        {
          x,
          y,
          color: "#ffffff",
          username: "",
        },
        { onConflict: "x,y" }
      );
    }
  };

  const handleTouchMove = (e) => {
    if (!isDrawing) return;

    const touch = e.touches[0];
    if (!touch) return;

    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!element || !element.dataset.index) return;

    const i = Number(element.dataset.index);
    const x = (i % GRID_SIZE) + 1;
    const y = Math.floor(i / GRID_SIZE) + 1;

    paintPixel(x, y, i);
  };

  const handleWheel = (e) => {
    e.preventDefault();

    if (e.deltaY < 0) {
      setScale((prev) => Math.min(prev + 0.1, 4));
    } else {
      setScale((prev) => Math.max(prev - 0.1, 0.5));
    }
  };

  const startPan = (e) => {
    if (e.button !== 1) return;

    setIsPanning(true);

    panStart.current = {
      x: e.clientX - offset.x,
      y: e.clientY - offset.y,
    };
  };

  const movePan = (e) => {
    if (!isPanning) return;

    setOffset({
      x: e.clientX - panStart.current.x,
      y: e.clientY - panStart.current.y,
    });
  };

  const endPan = () => {
    setIsPanning(false);
  };

  return (
    <main
      className="w-screen h-screen overflow-hidden bg-gray-100 touch-none"
      onMouseMove={movePan}
      onMouseUp={() => {
        setIsDrawing(false);
        endPan();
      }}
      onTouchEnd={() => setIsDrawing(false)}
      onTouchMove={handleTouchMove}
      onWheel={handleWheel}
    >
      <div
        className="fixed top-4 left-4 z-50 bg-white p-4 rounded shadow flex gap-4 items-center flex-wrap max-w-[95vw]"
        onMouseDown={(e) => e.stopPropagation()}
        onMouseMove={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <h1 className="font-bold text-xl">The Great Canvas</h1>

        <div className="flex items-center gap-2">
          <span>You:</span>
          <input
            className="border px-2 py-1 rounded w-32"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
          />
          <button
            className="bg-black text-white px-3 py-1 rounded"
            onClick={saveUsername}
          >
            Update
          </button>
        </div>

        <p className="font-bold text-green-600">Credits: {credits}</p>

        <button
          className="bg-black text-white px-4 py-2 rounded"
          onClick={buyCredits}
        >
          Buy 100 Credits ($1)
        </button>

        <button
          className="bg-white border px-4 py-2 rounded"
          onClick={loadCredits}
        >
          Refresh Credits
        </button>

        <input
          type="color"
          value={selectedColor}
          disabled={credits <= 0}
          onChange={(e) => setSelectedColor(e.target.value)}
        />

        <button
          className={`px-4 py-2 rounded border ${
            tool === "brush" ? "bg-black text-white" : "bg-white"
          }`}
          disabled={credits <= 0}
          onClick={() => setTool("brush")}
        >
          Brush
        </button>

        <button
          className={`px-4 py-2 rounded border ${
            tool === "eraser" ? "bg-black text-white" : "bg-white"
          }`}
          onClick={() => setTool("eraser")}
        >
          Eraser
        </button>

        <div>
          <p>
            Hover: ({hoveredSquare?.x}, {hoveredSquare?.y})
          </p>
          <p>Owner: {hoveredSquare?.username}</p>
        </div>

        <p>Zoom: {scale.toFixed(1)}x</p>
      </div>

      <div
        className="absolute"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <div className="grid grid-cols-50 w-fit">
          {squares.map((square, i) => {
            const x = (i % GRID_SIZE) + 1;
            const y = Math.floor(i / GRID_SIZE) + 1;

            const ownedByOther =
              square.color !== "#ffffff" && square.username !== username;

            return (
              <div
                key={i}
                data-index={i}
                className={`w-5 h-5 border ${
                  ownedByOther ? "cursor-not-allowed" : "cursor-crosshair"
                }`}
                style={{
                  backgroundColor: square.color,
                }}
                onMouseEnter={() => {
                  setHoveredSquare({
                    x,
                    y,
                    username: square.username,
                  });

                  if (isDrawing) {
                    paintPixel(x, y, i);
                  }
                }}
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    setIsDrawing(true);
                    paintPixel(x, y, i);
                  }

                  if (e.button === 1) {
                    startPan(e);
                  }
                }}
                onTouchStart={() => {
                  setIsDrawing(true);
                  paintPixel(x, y, i);
                }}
              />
            );
          })}
        </div>
      </div>
    </main>
  );
}