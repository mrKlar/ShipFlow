Feature: API behavior
  # ShipFlow generated Gherkin artifact

  Scenario: behavior-get-api-todos: POST then GET /api/todos exposes the created todo
    When ShipFlow when step 1
    When ShipFlow when step 2
    Then ShipFlow assert 1
    Then ShipFlow assert 2
    Then ShipFlow assert 3
    Then ShipFlow assert 4
    Then ShipFlow assert 5

  Scenario: behavior-get-api-todos: POST then GET /api/todos exposes the created todo [mutation guard]
    Then ShipFlow mutation guard
