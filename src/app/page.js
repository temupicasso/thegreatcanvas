"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const GRID_SIZE = 50;
  const PAYPAL_LINK =
    "https://www.paypal.com/ncp/payment/C6ZRQAW2LCT3Y";

  const [username, setUsername] = useState("Loading...");
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
      let saved = localStorage.getItem("username");

      if (!saved) {
        saved = "Guest" + Math.floor(1000 + Math.random() * 9000);
        localStorage.setItem("username", saved);
      }

      setUsername(saved);

      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("username", saved)
        .single();

      if (!data) {
        await supabase.from("users").insert({
          username: saved,
          credits: 0,
        });

        setCredits(0);
      } else {
        setCredits(data.credits);
      }
    }

    setupUser();
  }, []);

  const loadCredits = async () => {
    if (username === "Loading...") return;

    const { data } = await supabase
      .from("users")
      .select("credits")
      .eq("username", username)
      .single();

    if (data) setCredits(data.credits);
  };

  const updateCredits = async (newCredits) => {
    setCredits(newCredits);

    await supabase
      .from("users")
      .update({ credits: newCredits })
      .eq("username", username);
  };

  const loadCanvas = async () => {
    const { data, error } = await supabase.from("squares").select("*");

    if (error) {
      console.log(error);
      return;
    }

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
    await navigator.clipboard.writeText(username);

    alert(
      `Your username "${username}" has been copied.\n\nPaste/send this username after paying so credits can be added manually.`
    );

    window.open(PAYPAL_LINK, "_blank");
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

    const zoomSpeed = 0.1;

    if (e.deltaY < 0) {
      setScale((prev) => Math.min(prev + zoomSpeed, 4));
    } else {
      setScale((prev) => Math.max(prev - zoomSpeed, 0.5));
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
      <div className="fixed top-4 left-4 z-50 bg-white p-4 rounded shadow flex gap-4 items-center flex-wrap max-w-[95vw]">
        <h1 className="font-bold text-xl">The Great Canvas</h1>

        <p>
          You: <span className="font-bold">{username}</span>
        </p>

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