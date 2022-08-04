import React, { /*useRef,*/ useEffect } from 'react';
import { css, cx } from 'emotion';
import { stylesFactory /*, useTheme*/ } from '@grafana/ui';
import { PanelProps } from '@grafana/data';
import { SimpleOptions } from 'types';
import * as d3 from 'd3';
import { Temporal /*, Intl, toTemporalInstant */ } from '@js-temporal/polyfill';

const t = require('./d3-tip.min.js');
const fg = require('./d3-flamegraph.js');
const trace_graph = require('./trace.json');
const CEIL_HEIGHT = 40;
var flameGraph: any;
var parsed_array: any;
interface Props extends PanelProps<SimpleOptions> {}

export const SimplePanel: React.FC<Props> = ({ options, data, width, height }) => {
  useEffect(() => {
    function loadDataOnlyOnce() {
      (d3 as any).flameGraph = fg;
      (d3 as any).tip = t;
      flameGraph = (d3 as any)
        .flameGraph()
        .height(height * 0.75)
        .cellHeight(CEIL_HEIGHT)
        .transitionDuration(750)
        .sort(true)
        //Example to sort in reverse order
        .sort(sortFunction)
        .title('');
      var tip2 = (d3 as any)
        .tip()
        .direction('s')
        .offset([8, 0])
        .attr('class', 'd3-flame-graph-tip')
        .attr('id', 'd3-flame-graph-tip')
        .html(function (d: any) {
          return (
            'name: ' +
            d.data.name +
            ', value: ' +
            d.data.value.toLocaleString() +
            ', memory_pool: ' +
            get_memory_from_span(d.data).toLocaleString()
          );
        });
      flameGraph.tooltip(tip2);

      setTimeout(function () {
        var fragment = document.createDocumentFragment();
        const source_elem = document.getElementById('d3-flame-graph-tip')!;
        const dest_elemt = document.getElementById('tip-div')!;
        fragment.appendChild(source_elem);
        dest_elemt.appendChild(fragment);
      }, 5000);

      parsed_array = parseTraceGraph(trace_graph.graph.nodes, trace_graph.graph.edges);
      parsed_array = sumChildValues(parsed_array);
      d3.select('#flamegraph_container').datum(parsed_array).call(flameGraph);
    }
    loadDataOnlyOnce();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const styles = getStyles();

  return (
    <div
      className={cx(
        styles.wrapper,
        css`
          width: ${width}px;
          height: ${height}px;
        `
      )}
    >
      <link
        rel="stylesheet"
        type="text/css"
        href="https://cdn.jsdelivr.net/gh/spiermar/d3-flame-graph@1.0.4/dist/d3.flameGraph.min.css"
        integrity="sha256-w762vSe6WGrkVZ7gEOpnn2Y+FSmAGlX77jYj7nhuCyY="
        crossOrigin="anonymous"
      />
      <div id="main-container">
        <div id="flamegraph_container" style={containers_styles.flamegraph_container}>
          <div
            id="tip-div"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
            }}
          ></div>
        </div>
        <div id="right_menu_container" style={containers_styles.right_menu_container}>
          <button onClick={activateMemoryColor}>Show Memory Pool Usage</button>
        </div>
      </div>
    </div>
  );
};

function activateMemoryColor(): any {
  let { min_m, max_m } = get_min_max_memory(parsed_array);
  var boxes = document.getElementsByClassName('d3-flame-graph-label') as HTMLCollectionOf<HTMLElement>;
  for (let i = 0; i < boxes.length; i++) {
    boxes[i].style.color = 'black';
  }
  flameGraph.setColorMapper(function (d: any, originalColor: any) {
    const memory = get_memory_from_span(d.data);
    const percent = (memory - min_m) / (max_m - min_m);
    const hex_intensity = toHex(255 - Math.floor(percent * 255));
    return '#ff' + hex_intensity + hex_intensity;
  });
  removeBordersFromCells();
  flameGraph.update();
}

function removeBordersFromCells(): any {
  let elements = document.querySelectorAll('.d3-flame-graph rect') as NodeListOf<HTMLElement>;
  for (let i = 0; i < elements.length; i++) {
    elements[i].style.stroke = '#0000';
  }
}

function toHex(d: number) {
  return ('0' + Number(d).toString(16)).slice(-2).toUpperCase();
}

function sortFunction(a: any, b: any) {
  return compareTimeFunction(a.data.end_time, b.data.end_time);
}

function compareTimeFunction(a: any, b: any) {
  const a_endTime = convertPlainTimeToDuration(a);
  const b_endTime = convertPlainTimeToDuration(b);
  return Temporal.Duration.compare(a_endTime, b_endTime);
}

function parseTraceGraph(nodes_trace: any[], edges_trace: any[]): any {
  const nodes_set = new Set<number>();
  edges_trace.forEach(function (edge) {
    nodes_set.add(edge[0]);
    nodes_set.add(edge[1]);
  });

  const nodes_map = /*{};*/ new Map<number, any>();
  nodes_set.forEach(function (value1, value2) {
    var current_node = nodes_trace[Number(value2)];
    current_node.children = [];
    const start_time = current_node.start_time;
    const end_time = current_node.end_time;
    current_node.value = getDifference(start_time, end_time) - getIdleUntilFirstEvent(current_node);

    nodes_map.set(value2 as number, current_node);
  });

  edges_trace.forEach(function (edge) {
    const parent = edge[0];
    const child = edge[1];
    nodes_map.get(parent).children.push(nodes_map.get(child));
    nodes_set.delete(child);
  });

  for (var item of Array.from(nodes_set.values())) {
    return nodes_map.get(item);
  }
  return {};
}

function sumChildValues(tree: any): any {
  const childs = tree.children;
  tree.realValue = tree.value;
  tree.is_thread = 0;
  if (childs.length !== 0) {
    var i;
    for (i = 0; i < childs.length; i++) {
      sumChildValues(childs[i]);
    }
    var total_sum = 0;
    for (i = 0; i < childs.length; i++) {
      total_sum += childs[i].value;
    }
    if (tree.realValue < total_sum) {
      tree.value = total_sum;
      tree.is_thread = 1;
    }
    //REMOVE_EMPTY HOLES:*******
    if (tree.name.includes('Node:')) {
      tree.value = total_sum;
    }
    //*********** **************
  }
  return tree;
}

function get_min_max_memory(tree: any): any {
  const childs = tree.children;
  var current_min = get_memory_from_span(tree);
  var current_max = current_min;
  if (childs.length !== 0) {
    var i;
    for (i = 0; i < childs.length; i++) {
      let { min_m, max_m } = get_min_max_memory(childs[i]);
      current_min = Math.min(current_min, min_m);
      current_max = Math.max(current_max, max_m);
    }
  }
  return { min_m: current_min, max_m: current_max };
}

function get_memory_from_span(tree: any): number {
  if (tree.attributes != null && tree.attributes.length > 0) {
    for (var i = 0; i < tree.attributes.length; i++) {
      const attribute = tree.attributes[i];
      if (attribute.key === 'arrow.memory_pool_bytes') {
        return +attribute.value.intValue;
      }
    }
  }
  return 0;
}

function getIdleUntilFirstEvent(tree: any): any {
  const events = tree.events;
  if (tree.events != null && events.length !== 0) {
    const first_event = events.reduce(function (prev: any, curr: any) {
      return compareTimeFunction(prev.time, curr.time) < 0 && prev.name === 'InputReceived' ? prev : curr;
    });
    if (first_event.name === 'InputReceived') {
      const start_time = tree.start_time;
      const end_time = first_event.time;
      return getDifference(start_time, end_time);
    }
  }
  return 0;
}

function convertPlainTimeToDuration(value: any): Temporal.Duration {
  const next_unit_second = value[5];
  return Temporal.Duration.from({
    hours: value[2],
    minutes: value[3],
    seconds: value[4],
    milliseconds: ~~(next_unit_second / 1000000),
    microseconds: ~~((next_unit_second % 1000000) / 1000),
    nanoseconds: value[5] % 1000,
  });
}

function getDifference(startTime: Temporal.PlainTime, endTime: Temporal.PlainTime): number {
  const startDuration = convertPlainTimeToDuration(startTime);
  const endDuration = convertPlainTimeToDuration(endTime);
  return endDuration.subtract(startDuration).total({ unit: 'nanosecond' });
}

const getStyles = stylesFactory(() => {
  return {
    wrapper: css`
      position: relative;
    `,
    svg: css`
      position: absolute;
      top: 0;
      left: 0;
    `,
    div: css`
      position: absolute;
      bottom: 0;
      left: 0;
      padding: 10px;
    `,
  };
});

const containers_styles = {
  flamegraph_container: {
    float: 'left',
    width: '80%',
  } as React.CSSProperties,
  right_menu_container: {
    float: 'left',
    width: '20%',
  } as React.CSSProperties,
};
