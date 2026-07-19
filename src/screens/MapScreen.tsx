import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { Map, Camera, ViewAnnotation } from "@maplibre/maplibre-react-native"
import { RequetLocationPermission } from "../permissions/locationPermission";


export default function MapScreen() {
    const place = {
        id: "1",
        name: "Hyderabad",
        lng: 68.3578,
        lat: 25.3960,


    }
    async function getCurrentLocation() {
        const status = await RequetLocationPermission()
        if (!status) {
            return;
        }



    }

    useEffect(() => {
        getCurrentLocation()
    }, [])
    return (
        <View style={Style.container}>


            <Map
                style={Style.map}
                mapStyle={
                    "https://tiles.openfreemap.org/styles/bright"
                }


            >
                <Camera
                    center={[68.3578, 25.3960]}
                    zoom={14}
                />
                <ViewAnnotation
                    id={place.id}
                    lngLat={[place.lng, place.lat]}
                >
                    <View style={Style.markerContainer}>
                        <View style={Style.markerDot} />
                    </View>
                </ViewAnnotation>



            </Map>
        </View>
    )
}
const Style = StyleSheet.create({
    container: {
        flex: 1,

    },
    map: {
        flex: 1,
    },
    markerContainer: {
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#ac1818ff",
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: 2,
        borderColor: "#cb2029ff",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    markerDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: "#130304ff",
    },

})