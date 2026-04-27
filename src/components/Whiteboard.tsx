import { useRef, useEffect, useState } from 'react';
import { collection, addDoc, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { Plus, X } from 'lucide-react';

export const Whiteboard = ({ roomId }: { roomId: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#EF4444');
  const currentPathRef = useRef<{ x: number, y: number }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [strokes, setStrokes] = useState<any[]>([]);

  useEffect(() => {
    if (!roomId) return;
    const q = query(
      collection(db, 'rooms', roomId, 'whiteboard'),
      orderBy('timestamp', 'asc')
    );
    const unsubs = onSnapshot(q, (snap) => {
      const dbStrokes: any[] = [];
      snap.forEach(doc => {
         dbStrokes.push(doc.data());
      });
      setStrokes(dbStrokes);
    });
    return () => unsubs();
  }, [roomId]);

  useEffect(() => {
    // Redraw
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Config
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;

    strokes.forEach(stroke => {
       if (!stroke.path || stroke.path.length === 0) return;
       ctx.strokeStyle = stroke.color;
       ctx.beginPath();
       ctx.moveTo(stroke.path[0].x, stroke.path[0].y);
       stroke.path.forEach((p: any) => {
          ctx.lineTo(p.x, p.y);
       });
       ctx.stroke();
    });
  }, [strokes]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setIsDrawing(true);
    const pos = getPos(e);
    if (!pos) return;
    currentPathRef.current = [pos];
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    const pos = getPos(e);
    if (!pos) return;
    currentPathRef.current.push(pos);
    
    // Draw current segment
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.beginPath();
    const len = currentPathRef.current.length;
    if (len > 1) {
       ctx.moveTo(currentPathRef.current[len-2].x, currentPathRef.current[len-2].y);
       ctx.lineTo(pos.x, pos.y);
       ctx.stroke();
    }
  };

  const stopDrawing = async () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    
    if (currentPathRef.current.length > 0) {
       // Save to db
       try {
           await addDoc(collection(db, 'rooms', roomId, 'whiteboard'), {
              path: currentPathRef.current,
              color,
              timestamp: new Date()
           });
       } catch (e) {
           console.error("Failed to save stroke", e);
       }
    }
    currentPathRef.current = [];
  };

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    
    // Map to intrinsic canvas size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const colors = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#111827'];

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div className="flex items-center gap-2 p-3 border-b border-gray-200">
         <span className="text-sm font-semibold text-gray-700 mr-2">Color:</span>
         {colors.map(c => (
            <button
               key={c}
               onClick={() => setColor(c)}
               className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
               style={{ backgroundColor: c, borderColor: c === color ? '#60A5FA' : 'transparent' }}
            />
         ))}
      </div>
      <div className="flex-1 relative" ref={containerRef}>
         <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="w-full h-full object-contain cursor-crosshair touch-none"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
         />
      </div>
    </div>
  );
};
