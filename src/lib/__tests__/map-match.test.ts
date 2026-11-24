import { describe, expect, it } from "vitest";

import { findMatch, plainName } from "~/lib/map-match";

const carmel = { id: "p1", name: "Hotel Carmel", latitude: 34.0119, longitude: -118.4945 };
const courtyard = { id: "p2", name: "Courtyard Culver City", latitude: 34.0215, longitude: -118.3965 };

describe("is a point already on our map (doc §3.7)", () => {
  it("reads names without the stars in front, capitals or punctuation", () => {
    expect(plainName("5* The Langham, Pasadena")).toBe("the langham pasadena");
    expect(findMatch({ name: "2* Hotel Carmel", latitude: null, longitude: null }, [carmel], "property")).toMatchObject({ id: "p1", by: "name" });
  });

  it("takes a property on the same spot, whatever its name", () => {
    expect(findMatch({ name: "Carmel by the Sea Hotel", latitude: 34.0121, longitude: -118.4946 }, [carmel], "property")).toMatchObject({ id: "p1", by: "near" });
  });

  it("takes a property a little further off when the names share their main words", () => {
    const point = { name: "3* Courtyard by Marriott Culver City Los Angeles", latitude: 34.0225, longitude: -118.3985 };
    expect(findMatch(point, [courtyard], "property")).toMatchObject({ id: "p2" });
    expect(findMatch({ ...point, name: "Hampton Inn Culver" }, [courtyard], "property")).toBeNull();
    // Its name inside the other's, though the pins are far apart.
    expect(findMatch({ ...point, latitude: 33.9818, longitude: -118.3924 }, [courtyard], "property")).toMatchObject({ id: "p2", by: "similar" });
  });

  it("does not take a station beside a venue as the same point", () => {
    const venue = { id: "v", name: "Crypto.com Arena", latitude: 34.043, longitude: -118.2673 };
    expect(findMatch({ name: "Pico Station", latitude: 34.0431, longitude: -118.2672 }, [venue], "point")).toBeNull();
    expect(findMatch({ name: "Crypto Arena", latitude: 34.0431, longitude: -118.2672 }, [venue], "point")).toMatchObject({ id: "v" });
  });
});

describe("near is not enough on its own", () => {
  it("does not take two names sharing only a town as one", () => {
    const arena = { id: "a", name: "Long Beach Arena", latitude: 33.764, longitude: -118.188 };
    expect(findMatch({ name: "3* Residence Inn by Marriott Long Beach Downtown", latitude: 33.768, longitude: -118.19 }, [arena], "point")).toBeNull();
    const courtyardCC = { id: "c", name: "Courtyard Culver City", latitude: 34.0219, longitude: -118.3965 };
    expect(findMatch({ name: "4* Hilton Los Angeles Culver City", latitude: 34.0235, longitude: -118.3935 }, [courtyardCC], "property")).toBeNull();
  });

  it("leaves a different hotel next door, sharing only its town", () => {
    const ri = { id: "r", name: "Residence Inn Burbank Downtown", latitude: 34.1808, longitude: -118.3090 };
    expect(findMatch({ name: "3* Hotel Burbank", latitude: 34.1825, longitude: -118.3090 }, [ri], "property")).toBeNull();
    expect(findMatch({ name: "2* The Tangerine", latitude: 34.1814, longitude: -118.3090 }, [ri], "property")).toBeNull();
  });
});
