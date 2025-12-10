import React from 'react';
import { ChevronDown, Edit3, Eye, EyeOff } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { SliderControl } from './SliderControl';
import { NumberStepper } from './NumberStepper';
import { AnimationParams, MotionType, EldritchFocusParams, PBDConfig } from '@/lib/frameAnimator';

export interface AnchorCounts {
  rect: number;
  line: number;
  single: number;
}

export interface ControlPanelProps {
  params: AnimationParams;
  onParamsChange: (params: Partial<AnimationParams>) => void;
  anchorCounts?: AnchorCounts;
  onEditAnchors?: () => void;
  showAnchors?: boolean;
  onShowAnchorsChange?: (show: boolean) => void;
}

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, defaultOpen = true, children }) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-medium hover:text-foreground/80">
        {title}
        <ChevronDown
          className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pb-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
};

export const ControlPanel: React.FC<ControlPanelProps> = ({
  params,
  onParamsChange,
  anchorCounts = { rect: 0, line: 0, single: 0 },
  onEditAnchors,
  showAnchors = false,
  onShowAnchorsChange,
}) => {
  const updateParam = <K extends keyof AnimationParams>(
    key: K,
    value: AnimationParams[K]
  ) => {
    onParamsChange({ [key]: value });
  };

  // Helper to update nested eldritchFocus params
  const updateEldritchFocus = <K extends keyof EldritchFocusParams>(
    key: K,
    value: EldritchFocusParams[K]
  ) => {
    onParamsChange({
      eldritchFocus: {
        ...params.eldritchFocus,
        [key]: value,
      },
    });
  };

  // Helper to update motion weights
  const updateMotionWeight = (motion: keyof EldritchFocusParams['motionWeights'], value: number) => {
    onParamsChange({
      eldritchFocus: {
        ...params.eldritchFocus,
        motionWeights: {
          ...params.eldritchFocus.motionWeights,
          [motion]: value,
        },
      },
    });
  };

  // Helper to update PBD config
  const updatePBDConfig = <K extends keyof PBDConfig>(key: K, value: PBDConfig[K]) => {
    onParamsChange({
      pbdConfig: {
        ...params.pbdConfig,
        [key]: value,
      },
    });
  };

  const totalAnchors = anchorCounts.rect * 4 + anchorCounts.line * 2 + anchorCounts.single;

  return (
    <aside className="w-72 border-l h-full overflow-y-auto bg-background">
      <div className="p-4 space-y-2">
        <h2 className="font-semibold text-sm mb-4">Animation Controls</h2>

        {/* Motion Type */}
        <div className="space-y-2 pb-4 border-b">
          <Label className="text-sm">Motion Style</Label>
          <Select
            value={params.motionType}
            onValueChange={(v) => updateParam('motionType', v as MotionType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="psychedelic">Psychedelic</SelectItem>
              <SelectItem value="eldritch">Eldritch</SelectItem>
              <SelectItem value="vegetal">Vegetal (Wind)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Motion Settings */}
        <Section title="Motion">
          <SliderControl
            label="Speed"
            value={params.speed}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => updateParam('speed', v)}
          />
          <SliderControl
            label="Intensity"
            value={params.intensity}
            min={0}
            max={15}
            step={0.5}
            onChange={(v) => updateParam('intensity', v)}
          />
        </Section>

        {/* Psychedelic Settings */}
        {params.motionType === 'psychedelic' && (
          <Section title="Psychedelic Settings">
            <SliderControl
              label="Breathing Amount"
              value={params.breathingAmount}
              min={0}
              max={2}
              step={0.1}
              onChange={(v) => updateParam('breathingAmount', v)}
            />
            <SliderControl
              label="Warp Strength"
              value={params.warpStrength}
              min={0}
              max={40}
              step={1}
              onChange={(v) => updateParam('warpStrength', v)}
            />
          </Section>
        )}

        {/* Eldritch Settings - Focus-based system */}
        {params.motionType === 'eldritch' && (
          <>
            <Section title="Motion Types">
              <p className="text-xs text-muted-foreground pb-2">
                Relative odds for each motion style
              </p>
              <SliderControl
                label="Whip"
                value={params.eldritchFocus.motionWeights.whip}
                min={0}
                max={2}
                step={0.1}
                onChange={(v) => updateMotionWeight('whip', v)}
              />
              <SliderControl
                label="Quiver"
                value={params.eldritchFocus.motionWeights.quiver}
                min={0}
                max={2}
                step={0.1}
                onChange={(v) => updateMotionWeight('quiver', v)}
              />
              <SliderControl
                label="Strain"
                value={params.eldritchFocus.motionWeights.strain}
                min={0}
                max={2}
                step={0.1}
                onChange={(v) => updateMotionWeight('strain', v)}
              />
              <SliderControl
                label="Thrash"
                value={params.eldritchFocus.motionWeights.thrash}
                min={0}
                max={2}
                step={0.1}
                onChange={(v) => updateMotionWeight('thrash', v)}
              />
            </Section>

            <Section title="Focus Behavior" defaultOpen={false}>
              <div className="flex gap-2">
                <div className="flex-1">
                  <SliderControl
                    label="Min Foci"
                    value={params.eldritchFocus.minFoci}
                    min={1}
                    max={3}
                    step={1}
                    onChange={(v) => updateEldritchFocus('minFoci', v)}
                  />
                </div>
                <div className="flex-1">
                  <SliderControl
                    label="Max Foci"
                    value={params.eldritchFocus.maxFoci}
                    min={1}
                    max={4}
                    step={1}
                    onChange={(v) => updateEldritchFocus('maxFoci', v)}
                  />
                </div>
              </div>
              <SliderControl
                label="Burst Duration (min)"
                value={params.eldritchFocus.focusDurationMin}
                min={0.3}
                max={2}
                step={0.1}
                onChange={(v) => updateEldritchFocus('focusDurationMin', v)}
              />
              <SliderControl
                label="Burst Duration (max)"
                value={params.eldritchFocus.focusDurationMax}
                min={0.5}
                max={4}
                step={0.1}
                onChange={(v) => updateEldritchFocus('focusDurationMax', v)}
              />
              <SliderControl
                label="Rest Duration (min)"
                value={params.eldritchFocus.restDurationMin}
                min={0}
                max={2}
                step={0.1}
                onChange={(v) => updateEldritchFocus('restDurationMin', v)}
              />
              <SliderControl
                label="Rest Duration (max)"
                value={params.eldritchFocus.restDurationMax}
                min={0.2}
                max={3}
                step={0.1}
                onChange={(v) => updateEldritchFocus('restDurationMax', v)}
              />
            </Section>

            <Section title="Propagation" defaultOpen={false}>
              <SliderControl
                label="Wave Speed"
                value={params.eldritchFocus.propagationSpeed}
                min={0.5}
                max={5}
                step={0.1}
                onChange={(v) => updateEldritchFocus('propagationSpeed', v)}
              />
              <SliderControl
                label="Wave Decay"
                value={params.eldritchFocus.propagationDecay}
                min={0.05}
                max={0.5}
                step={0.01}
                onChange={(v) => updateEldritchFocus('propagationDecay', v)}
              />
              <SliderControl
                label="Base Intensity"
                value={params.eldritchFocus.baseIntensity}
                min={0.2}
                max={3}
                step={0.1}
                onChange={(v) => updateEldritchFocus('baseIntensity', v)}
              />
              <SliderControl
                label="Resting Drift"
                value={params.eldritchFocus.restingDrift}
                min={0}
                max={0.2}
                step={0.01}
                onChange={(v) => updateEldritchFocus('restingDrift', v)}
              />
            </Section>

            <Section title="Physics (PBD)" defaultOpen={false}>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox
                  id="use-pbd"
                  checked={params.usePBD}
                  onCheckedChange={(checked) => updateParam('usePBD', Boolean(checked))}
                />
                <Label htmlFor="use-pbd" className="text-xs cursor-pointer">
                  Enable curve continuity solver
                </Label>
              </div>
              {params.usePBD && (
                <>
                  <SliderControl
                    label="Solver Iterations"
                    value={params.pbdConfig.iterations}
                    min={1}
                    max={10}
                    step={1}
                    onChange={(v) => updatePBDConfig('iterations', v)}
                  />
                  <SliderControl
                    label="Distance Stiffness"
                    value={params.pbdConfig.distanceStiffness}
                    min={0.1}
                    max={1}
                    step={0.05}
                    onChange={(v) => updatePBDConfig('distanceStiffness', v)}
                  />
                  <SliderControl
                    label="Continuity Stiffness"
                    value={params.pbdConfig.continuityStiffness}
                    min={0.1}
                    max={1}
                    step={0.05}
                    onChange={(v) => updatePBDConfig('continuityStiffness', v)}
                  />
                  <SliderControl
                    label="Max Stretch"
                    value={params.pbdConfig.maxStretchRatio}
                    min={1.1}
                    max={3}
                    step={0.1}
                    onChange={(v) => updatePBDConfig('maxStretchRatio', v)}
                  />
                </>
              )}
            </Section>
          </>
        )}

        {/* Vegetal (Wind) Settings */}
        {params.motionType === 'vegetal' && (
          <Section title="Wind Settings">
            <SliderControl
              label="Wind Speed"
              value={params.windSpeed}
              min={0.1}
              max={2}
              step={0.1}
              onChange={(v) => updateParam('windSpeed', v)}
            />
            <SliderControl
              label="Wind Strength"
              value={params.windStrength}
              min={0}
              max={5}
              step={0.1}
              onChange={(v) => updateParam('windStrength', v)}
            />
            <div className="space-y-1">
              <SliderControl
                label="Wind Angle"
                value={params.windAngle}
                min={0}
                max={360}
                step={5}
                onChange={(v) => updateParam('windAngle', v)}
              />
              <p className="text-xs text-muted-foreground">
                0°→ 90°↓ 180°← 270°↑
              </p>
            </div>
            <SliderControl
              label="Gust Scale"
              value={params.gustScale}
              min={0.005}
              max={0.05}
              step={0.005}
              onChange={(v) => updateParam('gustScale', v)}
            />
            <SliderControl
              label="Flutter"
              value={params.flutterIntensity}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => updateParam('flutterIntensity', v)}
            />
          </Section>
        )}

        {/* Noise Settings */}
        <Section title="Noise" defaultOpen={false}>
          <SliderControl
            label="Noise Scale"
            value={params.noiseScale}
            min={0.001}
            max={0.05}
            step={0.001}
            onChange={(v) => updateParam('noiseScale', v)}
          />
          <SliderControl
            label="Octaves"
            value={params.octaves}
            min={1}
            max={6}
            step={1}
            onChange={(v) => updateParam('octaves', v)}
          />
        </Section>

        {/* Anchor Settings */}
        <Section title="Anchors" defaultOpen={false}>
          <SliderControl
            label="Falloff Radius"
            value={params.falloffRadius}
            min={5}
            max={60}
            step={1}
            onChange={(v) => updateParam('falloffRadius', v)}
          />

          <div className="space-y-3 pt-3 border-t">
            {/* Visibility toggle */}
            {onShowAnchorsChange && (
              <div className="flex items-center justify-between">
                <Label className="text-sm flex items-center gap-2">
                  {showAnchors ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  Show Anchors
                </Label>
                <Checkbox
                  checked={showAnchors}
                  onCheckedChange={(checked) => onShowAnchorsChange(checked === true)}
                />
              </div>
            )}

            {/* Read-only counts */}
            <div className="text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>Rectangles</span>
                <span>{anchorCounts.rect} ({anchorCounts.rect * 4} pts)</span>
              </div>
              <div className="flex justify-between">
                <span>Lines</span>
                <span>{anchorCounts.line} ({anchorCounts.line * 2} pts)</span>
              </div>
              <div className="flex justify-between">
                <span>Singles</span>
                <span>{anchorCounts.single} pts</span>
              </div>
              <div className="flex justify-between font-medium pt-1 border-t">
                <span>Total</span>
                <span>{totalAnchors} pts</span>
              </div>
            </div>

            {onEditAnchors && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onEditAnchors}
              >
                <Edit3 className="w-4 h-4 mr-2" />
                Edit Anchor Positions
              </Button>
            )}
          </div>
        </Section>

      </div>
    </aside>
  );
};
