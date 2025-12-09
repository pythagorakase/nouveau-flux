import React from 'react';
import { Button } from '@/components/ui/button';
import { Minus, Plus } from 'lucide-react';

interface NumberStepperProps {
    label: string;
    value: number;
    min?: number;
    max?: number;
    onChange: (value: number) => void;
}

export const NumberStepper: React.FC<NumberStepperProps> = ({
    label,
    value,
    min = 0,
    max = 100,
    onChange,
}) => {
    const decrement = () => {
        if (value > min) {
            onChange(value - 1);
        }
    };

    const increment = () => {
        if (value < max) {
            onChange(value + 1);
        }
    };

    return (
        <div className="flex items-center justify-between">
            <span className="text-sm">{label}</span>
            <div className="flex items-center gap-1">
                <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={decrement}
                    disabled={value <= min}
                    className="h-7 w-7"
                >
                    <Minus className="h-3 w-3" />
                </Button>
                <span className="w-8 text-center text-sm font-medium">{value}</span>
                <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={increment}
                    disabled={value >= max}
                    className="h-7 w-7"
                >
                    <Plus className="h-3 w-3" />
                </Button>
            </div>
        </div>
    );
};
