import Foundation
import HealthKit

/// One day of Apple Health totals, in the shape the tracker page expects.
struct DayRow {
    let date: String          // yyyy-MM-dd in the phone's time zone
    var steps: Int?
    var sleepHours: Double?
    var weightLb: Double?
    var activeKcal: Int?
    var exerciseMin: Int?
    var restingHr: Int?
    // Food logged in MyFitnessPal (or any app that shares nutrition with Apple Health).
    var kcalIn: Int?
    var proteinG: Double?
    var carbsG: Double?
    var fatG: Double?

    var hasData: Bool {
        steps != nil || sleepHours != nil || weightLb != nil || activeKcal != nil || exerciseMin != nil || restingHr != nil
            || kcalIn != nil || proteinG != nil || carbsG != nil || fatG != nil
    }

    var json: [String: Any] {
        var out: [String: Any] = ["date": date]
        if let v = steps { out["steps"] = v }
        if let v = sleepHours { out["sleepHours"] = v }
        if let v = weightLb { out["weightLb"] = v }
        if let v = activeKcal { out["activeKcal"] = v }
        if let v = exerciseMin { out["exerciseMin"] = v }
        if let v = restingHr { out["restingHr"] = v }
        if let v = kcalIn { out["kcalIn"] = v }
        if let v = proteinG { out["proteinG"] = v }
        if let v = carbsG { out["carbsG"] = v }
        if let v = fatG { out["fatG"] = v }
        return out
    }
}

/// Reads daily totals from Apple Health. Read-only: RENOVO never writes to Health.
final class HealthSync {
    static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    private let store = HKHealthStore()

    /// Whether the client has gone through the Connect step. (Apple doesn't tell apps which
    /// read permissions were granted; days the client didn't share simply come back empty.)
    var isConnected: Bool {
        get { UserDefaults.standard.bool(forKey: "healthConnected") }
        set { UserDefaults.standard.set(newValue, forKey: "healthConnected") }
    }

    private var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = []
        let quantities: [HKQuantityTypeIdentifier] = [.stepCount, .bodyMass, .activeEnergyBurned, .appleExerciseTime, .restingHeartRate,
                                                      .dietaryEnergyConsumed, .dietaryProtein, .dietaryCarbohydrates, .dietaryFatTotal]
        for id in quantities {
            if let type = HKObjectType.quantityType(forIdentifier: id) { types.insert(type) }
        }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
        return types
    }

    func requestAuthorization() async throws {
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    /// Daily rows for the last `days` days (today included), newest first.
    func dailyRows(days: Int) async -> [DayRow] {
        let cal = Calendar.current
        let end = Date()
        let today = cal.startOfDay(for: end)
        guard let start = cal.date(byAdding: .day, value: -(max(days, 1) - 1), to: today) else { return [] }

        let bpm = HKUnit.count().unitDivided(by: .minute())
        let steps = (try? await dailyStats(.stepCount, options: .cumulativeSum, unit: .count(), start: start, end: end)) ?? [:]
        let kcal = (try? await dailyStats(.activeEnergyBurned, options: .cumulativeSum, unit: .kilocalorie(), start: start, end: end)) ?? [:]
        let exercise = (try? await dailyStats(.appleExerciseTime, options: .cumulativeSum, unit: .minute(), start: start, end: end)) ?? [:]
        let restingHr = (try? await dailyStats(.restingHeartRate, options: .discreteAverage, unit: bpm, start: start, end: end)) ?? [:]
        let weight = (try? await dailyStats(.bodyMass, options: .mostRecent, unit: .pound(), start: start, end: end)) ?? [:]
        let sleep = (try? await dailySleepHours(start: start, end: end)) ?? [:]
        let food = (try? await dailyStats(.dietaryEnergyConsumed, options: .cumulativeSum, unit: .kilocalorie(), start: start, end: end)) ?? [:]
        let protein = (try? await dailyStats(.dietaryProtein, options: .cumulativeSum, unit: .gram(), start: start, end: end)) ?? [:]
        let carbs = (try? await dailyStats(.dietaryCarbohydrates, options: .cumulativeSum, unit: .gram(), start: start, end: end)) ?? [:]
        let fat = (try? await dailyStats(.dietaryFatTotal, options: .cumulativeSum, unit: .gram(), start: start, end: end)) ?? [:]

        var rows: [DayRow] = []
        var day = start
        while day <= end {
            let key = Self.dayKey(day)
            rows.append(DayRow(
                date: key,
                steps: Self.int(steps[key], within: 0...200_000),
                sleepHours: Self.round(sleep[key], places: 2, within: 0...24),
                weightLb: Self.round(weight[key], places: 1, within: 50...900),
                activeKcal: Self.int(kcal[key], within: 0...20_000),
                exerciseMin: Self.int(exercise[key], within: 0...1_440),
                restingHr: Self.int(restingHr[key], within: 20...250),
                kcalIn: Self.int(food[key], within: 0...20_000),
                proteinG: Self.round(protein[key], places: 1, within: 0...2_000),
                carbsG: Self.round(carbs[key], places: 1, within: 0...3_000),
                fatG: Self.round(fat[key], places: 1, within: 0...1_000)
            ))
            guard let next = cal.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }
        return rows.reversed()
    }

    // MARK: Queries

    /// One value per day: a sum (steps, calories, minutes), an average (resting heart rate)
    /// or the latest reading (weight). Apple Health removes double counting between iPhone and Watch.
    private func dailyStats(_ id: HKQuantityTypeIdentifier, options: HKStatisticsOptions, unit: HKUnit,
                            start: Date, end: Date) async throws -> [String: Double] {
        guard let type = HKQuantityType.quantityType(forIdentifier: id) else { return [:] }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
        let query = HKStatisticsCollectionQueryDescriptor(
            predicate: HKSamplePredicate.quantitySample(type: type, predicate: predicate),
            options: options,
            anchorDate: Calendar.current.startOfDay(for: start),
            intervalComponents: DateComponents(day: 1)
        )
        let collection = try await query.result(for: store)
        var out: [String: Double] = [:]
        collection.enumerateStatistics(from: start, to: end) { stats, _ in
            let quantity: HKQuantity?
            if options.contains(.cumulativeSum) {
                quantity = stats.sumQuantity()
            } else if options.contains(.discreteAverage) {
                quantity = stats.averageQuantity()
            } else {
                quantity = stats.mostRecentQuantity()
            }
            if let quantity = quantity {
                out[Self.dayKey(stats.startDate)] = quantity.doubleValue(for: unit)
            }
        }
        return out
    }

    /// Hours asleep, counted on the day the client woke up. Overlapping records from
    /// iPhone, Watch and sleep apps are merged so time is never counted twice.
    private func dailySleepHours(start: Date, end: Date) async throws -> [String: Double] {
        guard let type = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else { return [:] }
        // Start a day early so a night that began before `start` still counts on its wake-up day.
        let from = Calendar.current.date(byAdding: .day, value: -1, to: start) ?? start
        let predicate = HKQuery.predicateForSamples(withStart: from, end: end)
        let query = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: type, predicate: predicate)],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        let samples = try await query.result(for: store)

        let asleep: Set<Int> = [
            HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
            HKCategoryValueSleepAnalysis.asleepCore.rawValue,
            HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
            HKCategoryValueSleepAnalysis.asleepREM.rawValue,
        ]
        let startKey = Self.dayKey(start)
        var byDay: [String: [(Date, Date)]] = [:]
        for sample in samples where asleep.contains(sample.value) {
            let key = Self.dayKey(sample.endDate)
            if key < startKey { continue }
            byDay[key, default: []].append((sample.startDate, sample.endDate))
        }

        var out: [String: Double] = [:]
        for (key, intervals) in byDay {
            let seconds = Self.merge(intervals).reduce(0.0) { $0 + $1.1.timeIntervalSince($1.0) }
            if seconds > 0 { out[key] = seconds / 3600 }
        }
        return out
    }

    // MARK: Helpers

    static func merge(_ intervals: [(Date, Date)]) -> [(Date, Date)] {
        var merged: [(Date, Date)] = []
        for interval in intervals.sorted(by: { $0.0 < $1.0 }) {
            if let last = merged.last, interval.0 <= last.1 {
                merged[merged.count - 1].1 = max(last.1, interval.1)
            } else {
                merged.append(interval)
            }
        }
        return merged
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func dayKey(_ date: Date) -> String { dayFormatter.string(from: date) }

    private static func int(_ value: Double?, within range: ClosedRange<Double>) -> Int? {
        guard let v = value, range.contains(v) else { return nil }
        return Int(v.rounded())
    }

    private static func round(_ value: Double?, places: Int, within range: ClosedRange<Double>) -> Double? {
        guard let v = value, range.contains(v) else { return nil }
        let factor = pow(10.0, Double(places))
        return (v * factor).rounded() / factor
    }
}
