/**
 * @license
 * Copyright 2019 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  TRACE_START_MARK_PREFIX,
  TRACE_STOP_MARK_PREFIX,
  TRACE_MEASURE_PREFIX,
  OOB_TRACE_PAGE_LOAD_PREFIX,
  FIRST_PAINT_COUNTER_NAME,
  FIRST_CONTENTFUL_PAINT_COUNTER_NAME,
  FIRST_INPUT_DELAY_COUNTER_NAME
} from '../constants';
import { Api } from '../services/api_service';
import { logTrace } from '../services/perf_logger';
import { ERROR_FACTORY, ErrorCode } from '../utils/errors';
import { PerformanceTrace } from '@firebase/performance-types';

const enum TraceState {
  UNINITIALIZED = 1,
  RUNNING,
  TERMINATED
}

export class Trace implements PerformanceTrace {
  private state: TraceState = TraceState.UNINITIALIZED;
  startTimeUs!: number;
  durationUs!: number;
  private customAttributes: { [key: string]: string } = {};
  counters: { [counterName: string]: number } = {};
  private api = Api.getInstance();
  private randomId = Math.floor(Math.random() * 1000000);
  private traceStartMark!: string;
  private traceStopMark!: string;
  private traceMeasure!: string;

  /**
   * @param name The name of the trace.
   * @param isAuto If the trace is auto-instrumented.
   * @param traceMeasureName The name of the measure marker in user timing specification. This field
   * is only set when the trace is built for logging when the user directly uses the user timing
   * api (performance.mark and performance.measure).
   */
  constructor(
    readonly name: string,
    readonly isAuto = false,
    traceMeasureName?: string
  ) {
    if (!this.isAuto) {
      this.traceStartMark = `${TRACE_START_MARK_PREFIX}-${this.randomId}-${
        this.name
      }`;
      this.traceStopMark = `${TRACE_STOP_MARK_PREFIX}-${this.randomId}-${
        this.name
      }`;
      this.traceMeasure =
        traceMeasureName ||
        `${TRACE_MEASURE_PREFIX}-${this.randomId}-${this.name}`;

      if (traceMeasureName) {
        // For the case of direct user timing traces, no start stop will happen. The measure object
        // is already available.
        this.calculateTraceMetrics();
      }
    }
  }

  /**
   * Starts a trace. The measurement of the duration starts at this point.
   */
  start(): void {
    if (this.state !== TraceState.UNINITIALIZED) {
      throw ERROR_FACTORY.create(ErrorCode.TRACE_STARTED_BEFORE, {
        traceName: this.name
      });
    }
    this.api.mark(this.traceStartMark);
    this.state = TraceState.RUNNING;
  }

  /**
   * Stops the trace. The measurement of the duration of the trace stops at this point and trace
   * is logged.
   */
  stop(): void {
    if (this.state !== TraceState.RUNNING) {
      throw ERROR_FACTORY.create(ErrorCode.TRACE_STOPPED_BEFORE, {
        traceName: this.name
      });
    }
    this.state = TraceState.TERMINATED;
    this.api.mark(this.traceStopMark);
    this.api.measure(
      this.traceMeasure,
      this.traceStartMark,
      this.traceStopMark
    );
    this.calculateTraceMetrics();
    logTrace(this);
  }

  /**
   * Records a trace with predetermined values. If this method is used a trace is created and logged
   * directly. No need to use start and stop methods.
   * @param startTime Trace start time since epoch in millisec
   * @param duration The duraction of the trace in millisec
   * @param options An object which can optionally hold maps of custom metrics and custom attributes
   */
  record(
    startTime: number,
    duration: number,
    options?: {
      metrics?: { [key: string]: number };
      attributes?: { [key: string]: string };
    }
  ): void {
    this.durationUs = Math.floor(duration * 1000);
    this.startTimeUs = Math.floor(startTime * 1000);
    if (options && options.attributes) {
      this.customAttributes = { ...options.attributes };
    }
    if (options && options.metrics) {
      for (const metric of Object.keys(options.metrics)) {
        if (!isNaN(Number(options.metrics[metric]))) {
          this.counters[metric] = Number(Math.floor(options.metrics[metric]));
        }
      }
    }
    logTrace(this);
  }

  /**
   * Increments a custom metric by a certain number or 1 if number not specified. Will create a new
   * custom metric if one with the given name does not exist.
   * @param counter Name of the custom metric
   * @param num Increment by value
   */
  incrementMetric(counter: string, num = 1): void {
    if (this.counters[counter] === undefined) {
      this.counters[counter] = 0;
    }
    this.counters[counter] += num;
  }

  /**
   * Sets a custom metric to a specified value. Will create a new custom metric if one with the
   * given name does not exist.
   * @param counter Name of the custom metric
   * @param num Set custom metric to this value
   */
  putMetric(counter: string, num: number): void {
    this.counters[counter] = num;
  }

  /**
   * Returns the value of the custom metric by that name. If a custom metric with that name does
   * not exist will return zero.
   * @param counter
   */
  getMetric(counter: string): number {
    return this.counters[counter] || 0;
  }

  /**
   * Sets a custom attribute of a trace to a certain value.
   * @param attr
   * @param value
   */
  putAttribute(attr: string, value: string): void {
    this.customAttributes[attr] = value;
  }

  /**
   * Retrieves the value a custom attribute of a trace is set to.
   * @param attr
   */
  getAttribute(attr: string): string | undefined {
    return this.customAttributes[attr];
  }

  removeAttribute(attr: string): void {
    if (this.customAttributes[attr] === undefined) {
      return;
    }
    delete this.customAttributes[attr];
  }

  getAttributes(): { [key: string]: string } {
    return { ...this.customAttributes };
  }

  private setStartTime(startTime: number): void {
    this.startTimeUs = startTime;
  }

  private setDuration(duration: number): void {
    this.durationUs = duration;
  }

  /**
   * Calculates and assigns the duration and start time of the trace using the measure performance
   * entry.
   */
  private calculateTraceMetrics(): void {
    const perfMeasureEntries = this.api.getEntriesByName(this.traceMeasure);
    const perfMeasureEntry = perfMeasureEntries && perfMeasureEntries[0];
    if (perfMeasureEntry) {
      this.durationUs = Math.floor(perfMeasureEntry.duration * 1000);
      this.startTimeUs = Math.floor(
        (perfMeasureEntry.startTime + this.api.getTimeOrigin()) * 1000
      );
    }
  }

  /**
   * @param navigationTimings A single element array which contains the navigationTIming object of
   * the page load
   * @param paintTimings A array which contains paintTiming object of the page load
   * @param firstInputDelay First input delay in millisec
   */
  static createOobTrace(
    navigationTimings: PerformanceNavigationTiming[],
    paintTimings: PerformanceEntry[],
    firstInputDelay?: number
  ): void {
    const route = Api.getInstance().getUrl();
    if (!route) {
      return;
    }
    const trace = new Trace(OOB_TRACE_PAGE_LOAD_PREFIX + route, true);
    const timeOriginUs = Math.floor(Api.getInstance().getTimeOrigin() * 1000);
    trace.setStartTime(timeOriginUs);

    // navigationTimings includes only one element.
    if (navigationTimings && navigationTimings[0]) {
      trace.setDuration(Math.floor(navigationTimings[0].duration * 1000));
      trace.incrementMetric(
        'domInteractive',
        Math.floor(navigationTimings[0].domInteractive * 1000)
      );
      trace.incrementMetric(
        'domContentLoadedEventEnd',
        Math.floor(navigationTimings[0].domContentLoadedEventEnd * 1000)
      );
      trace.incrementMetric(
        'loadEventEnd',
        Math.floor(navigationTimings[0].loadEventEnd * 1000)
      );
    }

    const FIRST_PAINT = 'first-paint';
    const FIRST_CONTENTFUL_PAINT = 'first-contentful-paint';
    if (paintTimings) {
      const firstPaint = paintTimings.find(
        paintObject => paintObject.name === FIRST_PAINT
      );
      if (firstPaint && firstPaint.startTime) {
        trace.incrementMetric(
          FIRST_PAINT_COUNTER_NAME,
          Math.floor(firstPaint.startTime * 1000)
        );
      }
      const firstContentfulPaint = paintTimings.find(
        paintObject => paintObject.name === FIRST_CONTENTFUL_PAINT
      );
      if (firstContentfulPaint && firstContentfulPaint.startTime) {
        trace.incrementMetric(
          FIRST_CONTENTFUL_PAINT_COUNTER_NAME,
          Math.floor(firstContentfulPaint.startTime * 1000)
        );
      }

      if (firstInputDelay) {
        trace.incrementMetric(
          FIRST_INPUT_DELAY_COUNTER_NAME,
          Math.floor(firstInputDelay * 1000)
        );
      }
    }

    logTrace(trace);
  }

  static createUserTimingTrace(measureName: string): void {
    const trace = new Trace(measureName, false, measureName);
    logTrace(trace);
  }
}
