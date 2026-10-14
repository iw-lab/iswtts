import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

// 앱 아이콘 세트(v1.32.0) — 24×24 격자, 둥근 선 2px. 이모지·유니코드 글리프는 기기·폰트마다
// 모양이 달라 촌스럽다는 피드백(2026-07-08)으로 View 도형을 썼는데, 도형으로는 표현이 모자라
// 벡터(react-native-svg)로 바꿨다.
export type IconName =
  | 'play'
  | 'pause'
  | 'prev'
  | 'next'
  | 'back'
  | 'settings'
  | 'list'
  | 'moon'
  | 'sun'
  | 'search'
  | 'plus'
  | 'close'
  | 'book'
  | 'paste'
  | 'file'
  | 'more'
  | 'check'
  | 'battery'
  | 'voice'
  | 'trash'
  | 'edit'
  | 'restart'
  | 'clock';

type Props = { name: IconName; size?: number; color: string; strokeWidth?: number };

export default function Icon({ name, size = 24, color, strokeWidth = 2 }: Props) {
  const sp = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const fill = { fill: color };
  let body: React.ReactNode = null;
  switch (name) {
    case 'play':
      body = <Path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" {...fill} />;
      break;
    case 'pause':
      body = (
        <>
          <Rect x={6} y={5} width={4.2} height={14} rx={1.4} {...fill} />
          <Rect x={13.8} y={5} width={4.2} height={14} rx={1.4} {...fill} />
        </>
      );
      break;
    case 'prev':
      body = (
        <>
          <Path d="M17.5 6.2v11.6a.9.9 0 0 1-1.4.74L8.6 13.2a1.4 1.4 0 0 1 0-2.4l7.5-5.34a.9.9 0 0 1 1.4.74z" {...fill} />
          <Rect x={5.2} y={6} width={2.2} height={12} rx={1.1} {...fill} />
        </>
      );
      break;
    case 'next':
      body = (
        <>
          <Path d="M6.5 6.2v11.6a.9.9 0 0 0 1.4.74l7.5-5.34a1.4 1.4 0 0 0 0-2.4L7.9 5.46a.9.9 0 0 0-1.4.74z" {...fill} />
          <Rect x={16.6} y={6} width={2.2} height={12} rx={1.1} {...fill} />
        </>
      );
      break;
    case 'back':
      body = <Path d="M15 5l-7 7 7 7" {...sp} />;
      break;
    case 'settings':
      body = (
        <>
          <Circle cx={12} cy={12} r={3.2} {...sp} />
          <Path
            d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.9-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2.6-1.5L14 2.6h-4l-.4 2.4A7.5 7.5 0 0 0 7 6.5l-2.3-.9-2 3.4 1.9 1.5a7.6 7.6 0 0 0 0 3L2.7 15l2 3.4 2.3-.9a7.5 7.5 0 0 0 2.6 1.5l.4 2.4h4l.4-2.4a7.5 7.5 0 0 0 2.6-1.5l2.3.9 2-3.4z"
            {...sp}
          />
        </>
      );
      break;
    case 'list':
      body = <Path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01" {...sp} />;
      break;
    case 'moon':
      body = <Path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" {...sp} />;
      break;
    case 'sun':
      body = (
        <>
          <Circle cx={12} cy={12} r={4} {...sp} />
          <Path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" {...sp} />
        </>
      );
      break;
    case 'search':
      body = (
        <>
          <Circle cx={11} cy={11} r={6.5} {...sp} />
          <Path d="M16 16l4.5 4.5" {...sp} />
        </>
      );
      break;
    case 'plus':
      body = <Path d="M12 5v14M5 12h14" {...sp} />;
      break;
    case 'close':
      body = <Path d="M6 6l12 12M18 6L6 18" {...sp} />;
      break;
    case 'book':
      body = (
        <Path
          d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z"
          {...sp}
        />
      );
      break;
    case 'paste':
      body = (
        <>
          <Rect x={5} y={4.5} width={14} height={16} rx={2} {...sp} />
          <Path d="M9 4.5V3.8A1 1 0 0 1 10 2.8h4a1 1 0 0 1 1 1v.7M8.5 10h7M8.5 14h7M8.5 17.5h4" {...sp} />
        </>
      );
      break;
    case 'file':
      body = <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4" {...sp} />;
      break;
    case 'more':
      body = (
        <>
          <Circle cx={5.5} cy={12} r={1.6} {...fill} />
          <Circle cx={12} cy={12} r={1.6} {...fill} />
          <Circle cx={18.5} cy={12} r={1.6} {...fill} />
        </>
      );
      break;
    case 'check':
      body = <Path d="M5 12.5l4.5 4.5L19 7.5" {...sp} />;
      break;
    case 'battery':
      body = (
        <>
          <Rect x={3} y={7} width={16} height={10} rx={2.2} {...sp} />
          <Path d="M21.5 10.5v3M6.5 10.5v3M10 10.5v3" {...sp} />
        </>
      );
      break;
    case 'voice':
      body = <Path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3" {...sp} />;
      break;
    case 'trash':
      body = <Path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" {...sp} />;
      break;
    case 'edit':
      body = <Path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM14 7.5l3 3" {...sp} />;
      break;
    case 'restart':
      body = <Path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" {...sp} />;
      break;
    case 'clock':
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...sp} />
          <Path d="M12 7.5V12l3 2" {...sp} />
        </>
      );
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {body}
    </Svg>
  );
}
