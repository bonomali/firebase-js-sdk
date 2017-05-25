/**
* Copyright 2017 Google Inc.
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
  createFirebaseNamespace,
  FirebaseNamespace,
  FirebaseApp,
  FirebaseService
} from '../../../src/app/firebase_app';
import {assert} from 'chai';

describe("Firebase App Class", () => {
  let firebase: FirebaseNamespace;

  beforeEach(() => {
    firebase = createFirebaseNamespace();
  });

  it("No initial apps.", () => {
    assert.equal(firebase.apps.length, 0);
  });

  it("Can intialize DEFAULT App.", () => {
    let app = firebase.initializeApp({});
    assert.equal(firebase.apps.length, 1);
    assert.strictEqual(app, firebase.apps[0]);
    assert.equal(app.name, '[DEFAULT]');
    assert.strictEqual(firebase.app(), app);
    assert.strictEqual(firebase.app('[DEFAULT]'), app);
  });

  it("Can get options of App.", () => {
    const options = {'test': 'option'};
    let app = firebase.initializeApp(options);
    assert.deepEqual((app.options as any), (options as any));
  });

  it("Can delete App.", () => {
    let app = firebase.initializeApp({});
    assert.equal(firebase.apps.length, 1);
    return app.delete()
      .then(() => {
        assert.equal(firebase.apps.length, 0);
      });
  });

  it("Register App Hook", (done) => {
    let events = ['create', 'delete'];
    let hookEvents = 0;
    let app: FirebaseApp;;
    firebase.INTERNAL.registerService(
      'test',
      (app: FirebaseApp) => {
        return new TestService(app);
      },
      undefined,
      (event: string, app: FirebaseApp) => {
        assert.equal(event, events[hookEvents]);
        hookEvents += 1;
        if (hookEvents === events.length) {
          done();
        }
      });
    app = firebase.initializeApp({});
    // Ensure the hook is called synchronously
    assert.equal(hookEvents, 1);
    app.delete();
  });

  it("Can create named App.", () => {
    let app = firebase.initializeApp({}, 'my-app');
    assert.equal(firebase.apps.length, 1);
    assert.equal(app.name, 'my-app');
    assert.strictEqual(firebase.app('my-app'), app);
  });

  it("Can create named App and DEFAULT app.", () => {
    firebase.initializeApp({}, 'my-app');
    assert.equal(firebase.apps.length, 1);
    firebase.initializeApp({});
    assert.equal(firebase.apps.length, 2);
  });

  it("Can get app via firebase namespace.", () => {
    firebase.initializeApp({});
  });

  it("Duplicate DEFAULT initialize is an error.", () => {
    firebase.initializeApp({});
    assert.throws(() => {
      firebase.initializeApp({});
    }, /\[DEFAULT\].*exists/i);
  });

  it("Duplicate named App initialize is an error.", () => {
    firebase.initializeApp({}, 'abc');
    assert.throws(() => {
      firebase.initializeApp({}, 'abc');
    }, /'abc'.*exists/i);
  });

  it("Modifying options object does not change options.", () => {
    let options = {opt: 'original', nested: {opt: 123}};
    firebase.initializeApp(options);
    options.opt = 'changed';
    options.nested.opt = 456;
    assert.deepEqual(firebase.app().options,
                     {opt: 'original', nested: {opt: 123}});
  });

  it("Error to use app after it is deleted.", () => {
    let app = firebase.initializeApp({});
    return app.delete()
      .then(() => {
        assert.throws(() => {
          console.log(app.name);
        }, /already.*deleted/);
      });
  });

  it("OK to create same-name app after it is deleted.", () => {
    let app = firebase.initializeApp({}, 'app-name');
    return app.delete()
      .then(() => {
        let app2 = firebase.initializeApp({}, 'app-name');
        assert.ok(app !== app2, "Expect new instance.");
        // But original app id still orphaned.
        assert.throws(() => {
          console.log(app.name);
        }, /already.*deleted/);
      });
  });

  it("Only calls createService on first use (per app).", () => {
    let registrations = 0;
    firebase.INTERNAL.registerService('test', (app: FirebaseApp) => {
      registrations += 1;
      return new TestService(app);
    });
    let app = firebase.initializeApp({});
    assert.equal(registrations, 0);
    (firebase as any).test();
    assert.equal(registrations, 1);
    (firebase as any).test();
    assert.equal(registrations, 1);
    (firebase as any).test(app);
    assert.equal(registrations, 1);
    (app as any).test();
    assert.equal(registrations, 1);

    app = firebase.initializeApp({}, 'second');
    assert.equal(registrations, 1);
    (app as any).test();
    assert.equal(registrations, 2);
  });

  it("Can lazy load a service", () => {
    let registrations = 0;

    const app1 = firebase.initializeApp({});
    assert.isUndefined((app1 as any).lazyService);

    firebase.INTERNAL.registerService('lazyService', (app: FirebaseApp) => {
      registrations += 1;
      return new TestService(app);
    });

    assert.isDefined((app1 as any).lazyService);    

    // Initial service registration happens on first invocation
    assert.equal(registrations, 0);

    // Verify service has been registered
    (firebase as any).lazyService();
    assert.equal(registrations, 1);

    // Service should only be created once
    (firebase as any).lazyService();
    assert.equal(registrations, 1);

    // Service should only be created once... regardless of how you invoke the function
    (firebase as any).lazyService(app1);
    assert.equal(registrations, 1);

    // Service should already be defined for the second app
    const app2 = firebase.initializeApp({}, 'second');
    assert.isDefined((app1 as any).lazyService);
    
    // Service still should not have registered for the second app
    assert.equal(registrations, 1);

    // Service should initialize once called
    (app2 as any).lazyService();
    assert.equal(registrations, 2);
  });

  it("Can lazy register App Hook", (done) => {
    let events = ['create', 'delete'];
    let hookEvents = 0;
    const app = firebase.initializeApp({});
    firebase.INTERNAL.registerService(
      'lazyServiceWithHook',
      (app: FirebaseApp) => {
        return new TestService(app);
      },
      undefined,
      (event: string, app: FirebaseApp) => {
        assert.equal(event, events[hookEvents]);
        hookEvents += 1;
        if (hookEvents === events.length) {
          done();
        }
      });
    // Ensure the hook is called synchronously
    assert.equal(hookEvents, 1);
    app.delete();
  });

  it('Can register multiple instances of some services', () => {
    // Register Multi Instance Service
    firebase.INTERNAL.registerService(
      'multiInstance',
      (...args) => {
        const [app,,instanceIdentifier] = args;
        return new TestService(app, instanceIdentifier);
      },
      null,
      null,
      true
    );
    firebase.initializeApp({});

    // Capture a given service ref
    const service = (firebase.app() as any).multiInstance();
    assert.strictEqual(service, (firebase.app() as any).multiInstance());

    // Capture a custom instance service ref
    const serviceIdentifier = 'custom instance identifier';
    const service2 = (firebase.app() as any).multiInstance(serviceIdentifier);
    assert.strictEqual(service2, (firebase.app() as any).multiInstance(serviceIdentifier));

    // Ensure that the two services **are not equal**
    assert.notStrictEqual(service.instanceIdentifier, service2.instanceIdentifier, '`instanceIdentifier` is not being set correctly');
    assert.notStrictEqual(service, service2);
    assert.notStrictEqual((firebase.app() as any).multiInstance(), (firebase.app() as any).multiInstance(serviceIdentifier));
  });

  it(`Should return the same instance of a service if a service doesn't support multi instance`, () => {
    // Register Multi Instance Service
    firebase.INTERNAL.registerService(
      'singleInstance',
      (...args) => {
        const [app,,instanceIdentifier] = args;
        return new TestService(app, instanceIdentifier)
      },
      null,
      null,
      false // <-- multi instance flag
    );
    firebase.initializeApp({});

    // Capture a given service ref
    const serviceIdentifier = 'custom instance identifier';
    const service = (firebase.app() as any).singleInstance();
    const service2 = (firebase.app() as any).singleInstance(serviceIdentifier);

    // Ensure that the two services **are equal**
    assert.strictEqual(service.instanceIdentifier, service2.instanceIdentifier, '`instanceIdentifier` is not being set correctly');
    assert.strictEqual(service, service2);
  });

  describe("Check for bad app names", () => {
    let tests = ["", 123, false, null];
    for (let data of tests) {
      it("where name == '" + data + "'", () => {
        assert.throws(() => {
          firebase.initializeApp({}, data as string);
        }, /Illegal app name/i);;
      });
    }
  });
});

class TestService implements FirebaseService {
  constructor(private app_: FirebaseApp, public instanceIdentifier?: string) {}

  // TODO(koss): Shouldn't this just be an added method on
  // the service instance?
  get app(): FirebaseApp {
    return this.app_;
  }

  delete(): Promise<void> {
    return new Promise((resolve: (v?: void) => void) => {
      setTimeout(() => resolve(), 10);
    });
  }
}
