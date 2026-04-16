import React from 'react';
import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  text: string;
}

const MathText: React.FC<MathTextProps> = ({ text }) => {
  if (!text) return null;

  // Split the text into parts based on $...$ (inline) and $$...$$ (block) delimiters.
  // Using a capturing group in the split ensures the delimiters are kept in the parts list.
  const regex = /(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g;
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('$$') && part.endsWith('$$')) {
          // Block math: remove the $$ delimiters and render.
          const math = part.slice(2, -2).trim();
          return <BlockMath key={index}>{math}</BlockMath>;
        } else if (part.startsWith('$') && part.endsWith('$')) {
          // Inline math: remove the $ delimiters and render.
          const math = part.slice(1, -1).trim();
          return <InlineMath key={index}>{math}</InlineMath>;
        } else {
          // Normal text: render as-is.
          return <span key={index}>{part}</span>;
        }
      })}
    </>
  );
};

export default MathText;
