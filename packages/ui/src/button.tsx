import * as React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export function Button({ children, className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
