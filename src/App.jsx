// File: src/App.jsx  (only the top section changed)
import React from 'react';
import PersonaPanel from './components/PersonaPanel';
import HSKPicker from './components/HSKPicker';
import PDFUpload from './components/PDFUpload';
import Conversation from './components/Conversation';
import Avatar from './components/Avatar';
import Review from './components/Review';
import RealtimePanel from './components/RealtimePanel';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <h1 className="text-3xl font-bold mb-4">Huayu Buddy 中文对话</h1>
        <RealtimePanel />
      {/* Top row: Conversation grows; Avatar is fixed-height and independent */}
      <div className="grid md:grid-cols-2 gap-4 items-start">
        <Conversation />

        {/* Avatar card: fixed height; inner child stretched via CSS (no edit to Avatar.jsx) */}
        <div
          className="
            avatar-card relative overflow-hidden min-w-0
            bg-white rounded shadow
            h-[520px] md:h-[600px] lg:h-[680px]
          "
        >
          <Avatar />
        </div>
      </div>

      {/* Middle row: Persona + Loaders */}
      <div className="grid md:grid-cols-2 gap-4 mt-6 items-start">
        <PersonaPanel />
        <div className="grid gap-4">
          <HSKPicker />
          <PDFUpload />
        </div>
      </div>

      {/* Bottom: Review */}
      <div className="mt-6">
        <Review />
      </div>
    </div>
  );
}

