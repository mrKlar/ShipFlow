Feature: API behavior
  # ShipFlow generated Gherkin artifact

  Scenario: behavior-persist-todos-after-restart: Todos persist after an application restart
    Given ShipFlow given step 1
    Given ShipFlow given step 2
    Given ShipFlow given step 3
    When ShipFlow when step 1
    When ShipFlow when step 2
    Then ShipFlow assert 1
    Then ShipFlow assert 2
    Then ShipFlow assert 3
    Then ShipFlow assert 4
    Then ShipFlow assert 5

  Scenario: behavior-persist-todos-after-restart: Todos persist after an application restart [mutation guard]
    Then ShipFlow mutation guard
